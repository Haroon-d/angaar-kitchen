-- Transactional order cancellation.
-- Keeps order history intact while reversing inventory that was deducted at placement time.

CREATE OR REPLACE FUNCTION public.cancel_order(_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _order record;
  _movement record;
  _item record;
  _before numeric(14,3);
  _after numeric(14,3);
  _reverse_delta numeric(14,3);
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT o.id, o.branch_id, o.order_no, o.status, o.payment_status, o.amount_paid
    INTO _order
    FROM public.orders o
    WHERE o.id = _order_id
    FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF NOT public.can_manage_branch(_user, _order.branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _order.status = 'completed' THEN
    RAISE EXCEPTION 'completed orders cannot be cancelled';
  END IF;
  IF _order.status IN ('cancelled', 'voided', 'refunded') THEN
    RAISE EXCEPTION 'order is already %', _order.status;
  END IF;
  IF _order.payment_status <> 'pending' OR COALESCE(_order.amount_paid, 0) > 0 THEN
    RAISE EXCEPTION 'paid or partially paid orders must be refunded before cancellation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = _order_id) THEN
    RAISE EXCEPTION 'orders with payment records cannot be cancelled';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.inventory_movements im
      WHERE im.related_order_id = _order_id
        AND im.movement_type = 'correction'
        AND im.note = concat('Cancelled order ', _order.order_no)
  ) THEN
    RAISE EXCEPTION 'order inventory has already been reversed';
  END IF;

  FOR _movement IN
    SELECT im.*
      FROM public.inventory_movements im
      WHERE im.related_order_id = _order_id
        AND im.movement_type = 'sale'
        AND im.quantity_delta < 0
      ORDER BY im.created_at, im.id
  LOOP
    SELECT ii.id, ii.current_qty, ii.average_cost
      INTO _item
      FROM public.inventory_items ii
      WHERE ii.id = _movement.inventory_item_id
      FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'inventory item not found for order reversal'; END IF;

    _reverse_delta := round(abs(_movement.quantity_delta), 3);
    _before := _item.current_qty;
    _after := round(_before + _reverse_delta, 3);

    UPDATE public.inventory_items
      SET current_qty = _after
      WHERE id = _item.id;

    INSERT INTO public.inventory_movements(
      branch_id, inventory_item_id, movement_type, reason, quantity_delta,
      before_qty, after_qty, unit_cost, related_order_id, actor_id, note
    ) VALUES (
      _order.branch_id, _item.id, 'correction', 'correction', _reverse_delta,
      _before, _after, COALESCE(_movement.unit_cost, _item.average_cost, 0),
      _order_id, _user, concat('Cancelled order ', _order.order_no)
    );
  END LOOP;

  UPDATE public.orders
    SET status = 'cancelled',
        completed_at = NULL,
        updated_at = now()
    WHERE id = _order_id;

  INSERT INTO public.audit_log(restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
    SELECT b.restaurant_id, _order.branch_id, _user, 'order', _order_id, 'cancelled',
           jsonb_build_object('order_no', _order.order_no)
      FROM public.branches b
      WHERE b.id = _order.branch_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.record_payment(
  _order_id uuid,
  _method payment_method,
  _amount numeric,
  _reference text DEFAULT NULL
) RETURNS TABLE(payment_id uuid, new_amount_paid numeric, new_payment_status payment_status_t)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _order record;
  _pay_id uuid := gen_random_uuid();
  _new_paid numeric(12,2);
  _new_status payment_status_t;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid amount'; END IF;

  SELECT o.id, o.branch_id, o.grand_total, o.amount_paid, o.payment_status, o.status
    INTO _order FROM public.orders o WHERE o.id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF NOT public.can_access_branch(_user, _order.branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _order.status IN ('cancelled', 'voided', 'refunded') THEN
    RAISE EXCEPTION 'cannot record payment for % order', _order.status;
  END IF;
  IF _order.payment_status = 'refunded' THEN RAISE EXCEPTION 'order refunded'; END IF;

  INSERT INTO public.payments(id, order_id, method, amount, reference, received_by)
    VALUES (_pay_id, _order_id, _method, _amount, NULLIF(trim(_reference),''), _user);

  _new_paid := round(_order.amount_paid + _amount, 2);
  IF _new_paid >= _order.grand_total THEN
    _new_status := 'paid';
  ELSIF _new_paid > 0 THEN
    _new_status := 'partial';
  ELSE
    _new_status := 'pending';
  END IF;

  UPDATE public.orders
     SET amount_paid = _new_paid,
         payment_status = _new_status,
         status = CASE WHEN _new_status = 'paid' THEN 'completed'::order_status ELSE status END,
         completed_at = CASE WHEN _new_status = 'paid' AND completed_at IS NULL THEN now() ELSE completed_at END,
         updated_at = now()
   WHERE id = _order_id;

  INSERT INTO public.audit_log(restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
    SELECT b.restaurant_id, _order.branch_id, _user, 'payment', _pay_id, 'recorded',
           jsonb_build_object('order_id', _order_id, 'amount', _amount, 'method', _method, 'new_status', _new_status)
      FROM public.branches b WHERE b.id = _order.branch_id;

  payment_id := _pay_id;
  new_amount_paid := _new_paid;
  new_payment_status := _new_status;
  RETURN NEXT;
END $function$;

CREATE OR REPLACE FUNCTION public.record_print(
  _order_id uuid,
  _kind text
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _order record;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _kind NOT IN ('kot','bill','receipt') THEN RAISE EXCEPTION 'invalid print kind'; END IF;

  SELECT o.id, o.branch_id, o.status INTO _order FROM public.orders o WHERE o.id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF NOT public.can_access_branch(_user, _order.branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _order.status IN ('cancelled', 'voided', 'refunded') THEN
    RAISE EXCEPTION 'cannot print % order', _order.status;
  END IF;

  UPDATE public.orders
     SET kot_print_count     = kot_print_count     + CASE WHEN _kind='kot'     THEN 1 ELSE 0 END,
         bill_print_count    = bill_print_count    + CASE WHEN _kind='bill'    THEN 1 ELSE 0 END,
         receipt_print_count = receipt_print_count + CASE WHEN _kind='receipt' THEN 1 ELSE 0 END,
         last_printed_at = now(),
         updated_at = now()
   WHERE id = _order_id;

  INSERT INTO public.audit_log(restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
    SELECT b.restaurant_id, _order.branch_id, _user, 'order', _order_id, 'print_' || _kind,
           jsonb_build_object('kind', _kind)
      FROM public.branches b WHERE b.id = _order.branch_id;
END $function$;

GRANT EXECUTE ON FUNCTION public.cancel_order(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payment(uuid, payment_method, numeric, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.record_payment(uuid, payment_method, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_print(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.record_print(uuid, text) FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';
