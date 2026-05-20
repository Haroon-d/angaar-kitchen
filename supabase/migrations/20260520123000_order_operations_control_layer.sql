-- Order operations control layer.
-- Adds auditable cancel, void, refund, reopen, and admin delete workflows.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'payment';

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_amount_check;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_kind_amount_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_kind_amount_check
  CHECK (
    (kind = 'payment' AND amount > 0)
    OR (kind IN ('refund', 'void_adjustment') AND amount < 0)
  );

CREATE OR REPLACE FUNCTION public.reverse_order_inventory(
  _order_id uuid,
  _branch_id uuid,
  _actor_id uuid,
  _note text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _net record;
  _item record;
  _before numeric(14,3);
  _after numeric(14,3);
  _delta numeric(14,3);
  _count integer := 0;
BEGIN
  FOR _net IN
    SELECT im.inventory_item_id, round(sum(im.quantity_delta), 3) AS net_delta
      FROM public.inventory_movements im
      WHERE im.related_order_id = _order_id
        AND im.movement_type IN ('sale', 'correction')
      GROUP BY im.inventory_item_id
      HAVING round(sum(im.quantity_delta), 3) <> 0
      ORDER BY im.inventory_item_id
  LOOP
    SELECT ii.id, ii.current_qty, ii.average_cost
      INTO _item
      FROM public.inventory_items ii
      WHERE ii.id = _net.inventory_item_id
      FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'inventory item not found for order reversal'; END IF;

    _delta := round(-1 * _net.net_delta, 3);
    _before := _item.current_qty;
    _after := round(_before + _delta, 3);

    UPDATE public.inventory_items
      SET current_qty = _after
      WHERE id = _item.id;

    INSERT INTO public.inventory_movements(
      branch_id, inventory_item_id, movement_type, reason, quantity_delta,
      before_qty, after_qty, unit_cost, related_order_id, actor_id, note
    ) VALUES (
      _branch_id, _item.id, 'correction', 'correction', _delta,
      _before, _after, COALESCE(_item.average_cost, 0),
      _order_id, _actor_id, _note
    );

    _count := _count + 1;
  END LOOP;

  RETURN _count;
END
$function$;

DROP FUNCTION IF EXISTS public.cancel_order(uuid);

CREATE OR REPLACE FUNCTION public.cancel_order(
  _order_id uuid,
  _reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _order record;
  _restaurant uuid;
  _reason_clean text := NULLIF(trim(COALESCE(_reason, '')), '');
  _reversed integer;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _reason_clean IS NULL THEN RAISE EXCEPTION 'cancellation reason required'; END IF;

  SELECT o.id, o.branch_id, o.order_no, o.status, o.payment_status, o.amount_paid
    INTO _order
    FROM public.orders o
    WHERE o.id = _order_id
    FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF NOT public.can_manage_branch(_user, _order.branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _order.status IN ('cancelled', 'voided', 'refunded') THEN
    RAISE EXCEPTION 'order is already %', _order.status;
  END IF;
  IF _order.payment_status <> 'pending' OR COALESCE(_order.amount_paid, 0) > 0 THEN
    RAISE EXCEPTION 'paid or partially paid orders must be voided or refunded';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = _order_id) THEN
    RAISE EXCEPTION 'orders with payment records must be voided or refunded';
  END IF;

  SELECT b.restaurant_id INTO _restaurant
    FROM public.branches b
    WHERE b.id = _order.branch_id;
  IF _restaurant IS NULL THEN RAISE EXCEPTION 'branch not found'; END IF;

  _reversed := public.reverse_order_inventory(
    _order_id, _order.branch_id, _user, concat('Cancelled order ', _order.order_no)
  );

  UPDATE public.orders
    SET status = 'cancelled',
        completed_at = NULL,
        updated_at = now()
    WHERE id = _order_id;

  INSERT INTO public.audit_log(restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
    VALUES (
      _restaurant, _order.branch_id, _user, 'order', _order_id, 'cancelled',
      jsonb_build_object(
        'order_no', _order.order_no,
        'old_status', _order.status,
        'inventory_reversal_count', _reversed,
        'reason', _reason_clean
      )
    );
END
$function$;

CREATE OR REPLACE FUNCTION public.void_order(
  _order_id uuid,
  _reason text,
  _refund_paid boolean DEFAULT true,
  _method payment_method DEFAULT 'cash',
  _reference text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _order record;
  _restaurant uuid;
  _reason_clean text := NULLIF(trim(COALESCE(_reason, '')), '');
  _refund_id uuid;
  _reversed integer;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _reason_clean IS NULL THEN RAISE EXCEPTION 'void reason required'; END IF;

  SELECT o.id, o.branch_id, o.order_no, o.status, o.payment_status, o.amount_paid
    INTO _order
    FROM public.orders o
    WHERE o.id = _order_id
    FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF NOT public.can_manage_branch(_user, _order.branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _order.status IN ('cancelled', 'voided', 'refunded') THEN
    RAISE EXCEPTION 'order is already %', _order.status;
  END IF;
  IF COALESCE(_order.amount_paid, 0) > 0 AND NOT _refund_paid THEN
    RAISE EXCEPTION 'paid voids must include a payment reversal';
  END IF;

  SELECT b.restaurant_id INTO _restaurant
    FROM public.branches b
    WHERE b.id = _order.branch_id;
  IF _restaurant IS NULL THEN RAISE EXCEPTION 'branch not found'; END IF;

  _reversed := public.reverse_order_inventory(
    _order_id, _order.branch_id, _user, concat('Voided order ', _order.order_no)
  );

  IF COALESCE(_order.amount_paid, 0) > 0 THEN
    _refund_id := gen_random_uuid();
    INSERT INTO public.payments(id, order_id, method, amount, kind, reference, received_by)
      VALUES (
        _refund_id, _order_id, _method, -1 * round(_order.amount_paid, 2), 'void_adjustment',
        NULLIF(trim(COALESCE(_reference, '')), ''), _user
      );
  END IF;

  UPDATE public.orders
    SET status = 'voided',
        payment_status = CASE WHEN COALESCE(_order.amount_paid, 0) > 0 THEN 'refunded'::payment_status_t ELSE 'pending'::payment_status_t END,
        amount_paid = 0,
        completed_at = NULL,
        updated_at = now()
    WHERE id = _order_id;

  INSERT INTO public.audit_log(restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
    VALUES (
      _restaurant, _order.branch_id, _user, 'order', _order_id, 'voided',
      jsonb_build_object(
        'order_no', _order.order_no,
        'old_status', _order.status,
        'old_payment_status', _order.payment_status,
        'reversed_payment_amount', COALESCE(_order.amount_paid, 0),
        'payment_reversal_id', _refund_id,
        'inventory_reversal_count', _reversed,
        'reason', _reason_clean
      )
    );
END
$function$;

CREATE OR REPLACE FUNCTION public.refund_order(
  _order_id uuid,
  _amount numeric,
  _method payment_method,
  _reason text,
  _restore_inventory boolean DEFAULT true,
  _reference text DEFAULT NULL
) RETURNS TABLE(refund_payment_id uuid, new_amount_paid numeric, new_payment_status payment_status_t)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _order record;
  _restaurant uuid;
  _reason_clean text := NULLIF(trim(COALESCE(_reason, '')), '');
  _refund_id uuid := gen_random_uuid();
  _refund_amount numeric(12,2);
  _new_paid numeric(12,2);
  _new_status payment_status_t;
  _new_order_status order_status;
  _reversed integer := 0;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _reason_clean IS NULL THEN RAISE EXCEPTION 'refund reason required'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid refund amount'; END IF;

  SELECT o.id, o.branch_id, o.order_no, o.status, o.payment_status, o.amount_paid
    INTO _order
    FROM public.orders o
    WHERE o.id = _order_id
    FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF NOT public.can_manage_branch(_user, _order.branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _order.status IN ('cancelled', 'voided', 'refunded') THEN
    RAISE EXCEPTION 'cannot refund % order', _order.status;
  END IF;
  IF COALESCE(_order.amount_paid, 0) <= 0 THEN RAISE EXCEPTION 'order has no payment to refund'; END IF;

  _refund_amount := LEAST(round(_amount, 2), round(_order.amount_paid, 2));
  _new_paid := round(_order.amount_paid - _refund_amount, 2);

  IF _new_paid <= 0 THEN
    _new_paid := 0;
    _new_status := 'refunded';
    _new_order_status := 'refunded';
  ELSIF _new_paid > 0 THEN
    _new_status := 'partial';
    _new_order_status := _order.status;
  END IF;

  SELECT b.restaurant_id INTO _restaurant
    FROM public.branches b
    WHERE b.id = _order.branch_id;
  IF _restaurant IS NULL THEN RAISE EXCEPTION 'branch not found'; END IF;

  INSERT INTO public.payments(id, order_id, method, amount, kind, reference, received_by)
    VALUES (
      _refund_id, _order_id, _method, -1 * _refund_amount, 'refund',
      NULLIF(trim(COALESCE(_reference, '')), ''), _user
    );

  IF _restore_inventory AND _new_status = 'refunded' THEN
    _reversed := public.reverse_order_inventory(
      _order_id, _order.branch_id, _user, concat('Refunded order ', _order.order_no)
    );
  END IF;

  UPDATE public.orders
    SET amount_paid = _new_paid,
        payment_status = _new_status,
        status = _new_order_status,
        completed_at = CASE WHEN _new_order_status = 'refunded' THEN NULL ELSE completed_at END,
        updated_at = now()
    WHERE id = _order_id;

  INSERT INTO public.audit_log(restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
    VALUES (
      _restaurant, _order.branch_id, _user, 'payment', _refund_id, 'refunded',
      jsonb_build_object(
        'order_id', _order_id,
        'order_no', _order.order_no,
        'amount', _refund_amount,
        'new_amount_paid', _new_paid,
        'new_payment_status', _new_status,
        'restore_inventory', _restore_inventory,
        'inventory_reversal_count', _reversed,
        'reason', _reason_clean
      )
    );

  refund_payment_id := _refund_id;
  new_amount_paid := _new_paid;
  new_payment_status := _new_status;
  RETURN NEXT;
END
$function$;

CREATE OR REPLACE FUNCTION public.reopen_order(
  _order_id uuid,
  _reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _order record;
  _restaurant uuid;
  _reason_clean text := NULLIF(trim(COALESCE(_reason, '')), '');
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _reason_clean IS NULL THEN RAISE EXCEPTION 'reopen reason required'; END IF;

  SELECT o.id, o.branch_id, o.order_no, o.status, o.payment_status
    INTO _order
    FROM public.orders o
    WHERE o.id = _order_id
    FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF NOT public.can_manage_branch(_user, _order.branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _order.status <> 'completed' THEN RAISE EXCEPTION 'only completed orders can be reopened'; END IF;
  IF _order.payment_status = 'refunded' THEN RAISE EXCEPTION 'refunded orders cannot be reopened'; END IF;

  SELECT b.restaurant_id INTO _restaurant
    FROM public.branches b
    WHERE b.id = _order.branch_id;
  IF _restaurant IS NULL THEN RAISE EXCEPTION 'branch not found'; END IF;

  UPDATE public.orders
    SET status = 'served',
        completed_at = NULL,
        updated_at = now()
    WHERE id = _order_id;

  INSERT INTO public.audit_log(restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
    VALUES (
      _restaurant, _order.branch_id, _user, 'order', _order_id, 'reopened',
      jsonb_build_object('order_no', _order.order_no, 'old_status', _order.status, 'reason', _reason_clean)
    );
END
$function$;

CREATE OR REPLACE FUNCTION public.delete_order_admin(
  _order_id uuid,
  _reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _order record;
  _restaurant uuid;
  _reason_clean text := NULLIF(trim(COALESCE(_reason, '')), '');
  _reversed integer;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _reason_clean IS NULL THEN RAISE EXCEPTION 'delete reason required'; END IF;

  SELECT o.*
    INTO _order
    FROM public.orders o
    WHERE o.id = _order_id
    FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;

  SELECT b.restaurant_id INTO _restaurant
    FROM public.branches b
    WHERE b.id = _order.branch_id;
  IF _restaurant IS NULL THEN RAISE EXCEPTION 'branch not found'; END IF;
  IF NOT public.is_restaurant_admin(_user, _restaurant) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _order.status NOT IN ('cancelled', 'voided', 'refunded') THEN
    RAISE EXCEPTION 'only cancelled, voided, or refunded orders can be deleted';
  END IF;

  _reversed := public.reverse_order_inventory(
    _order_id, _order.branch_id, _user, concat('Deleted order ', _order.order_no)
  );

  INSERT INTO public.audit_log(restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
    VALUES (
      _restaurant, _order.branch_id, _user, 'order', _order_id, 'deleted',
      jsonb_build_object(
        'order_no', _order.order_no,
        'status', _order.status,
        'payment_status', _order.payment_status,
        'grand_total', _order.grand_total,
        'amount_paid', _order.amount_paid,
        'inventory_reversal_count', _reversed,
        'reason', _reason_clean
      )
    );

  DELETE FROM public.orders o WHERE o.id = _order_id;
END
$function$;

GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_order(uuid, text, boolean, payment_method, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.void_order(uuid, text, boolean, payment_method, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_order(uuid, numeric, payment_method, text, boolean, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_order(uuid, numeric, payment_method, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_order(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.reopen_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_order_admin(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_order_admin(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reverse_order_inventory(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
