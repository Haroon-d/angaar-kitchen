-- Payment-safe order discount correction.
-- Does not change order items, payments, or inventory movements.

CREATE OR REPLACE FUNCTION public.adjust_order_discount(
  _order_id uuid,
  _discount numeric,
  _reason text DEFAULT NULL
) RETURNS TABLE(order_id uuid, order_no text, new_grand_total numeric, new_payment_status payment_status_t)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _order record;
  _restaurant uuid;
  _discount_total numeric(12,2);
  _taxable numeric(12,2);
  _tax_total numeric(12,2) := 0;
  _grand numeric(12,2);
  _tax record;
  _tax_amount numeric(12,2);
  _new_status payment_status_t;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _discount IS NULL OR _discount < 0 THEN RAISE EXCEPTION 'invalid discount'; END IF;
  IF NULLIF(trim(COALESCE(_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'discount adjustment reason required';
  END IF;

  SELECT o.id, o.branch_id, o.order_no, o.status, o.payment_status, o.subtotal,
         o.discount_total, o.tax_total, o.grand_total, o.amount_paid
    INTO _order
    FROM public.orders o
    WHERE o.id = _order_id
    FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF NOT public.can_manage_branch(_user, _order.branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _order.status IN ('cancelled', 'voided', 'refunded') THEN
    RAISE EXCEPTION 'cannot adjust discount for % order', _order.status;
  END IF;
  IF _order.payment_status = 'refunded' THEN RAISE EXCEPTION 'order refunded'; END IF;

  SELECT b.restaurant_id INTO _restaurant
    FROM public.branches b
    WHERE b.id = _order.branch_id;
  IF _restaurant IS NULL THEN RAISE EXCEPTION 'branch not found'; END IF;

  _discount_total := GREATEST(0, LEAST(round(_discount, 2), _order.subtotal));
  _taxable := round(_order.subtotal - _discount_total, 2);

  FOR _tax IN
    SELECT t.id, t.name, t.rate, t.is_inclusive
      FROM public.taxes t
      WHERE t.restaurant_id = _restaurant
        AND t.is_active
        AND t.apply_by_default
  LOOP
    IF _tax.is_inclusive THEN
      _tax_amount := round(_taxable - (_taxable / (1 + _tax.rate / 100)), 2);
    ELSE
      _tax_amount := round(_taxable * _tax.rate / 100, 2);
      _tax_total := _tax_total + _tax_amount;
    END IF;
  END LOOP;

  _grand := round(_taxable + _tax_total, 2);

  IF COALESCE(_order.amount_paid, 0) > _grand THEN
    RAISE EXCEPTION 'new total is below amount already paid; refund flow required';
  END IF;

  IF COALESCE(_order.amount_paid, 0) >= _grand AND _grand > 0 THEN
    _new_status := 'paid';
  ELSIF COALESCE(_order.amount_paid, 0) > 0 THEN
    _new_status := 'partial';
  ELSE
    _new_status := 'pending';
  END IF;

  DELETE FROM public.order_taxes ot WHERE ot.order_id = _order_id;

  FOR _tax IN
    SELECT t.id, t.name, t.rate, t.is_inclusive
      FROM public.taxes t
      WHERE t.restaurant_id = _restaurant
        AND t.is_active
        AND t.apply_by_default
  LOOP
    IF _tax.is_inclusive THEN
      _tax_amount := round(_taxable - (_taxable / (1 + _tax.rate / 100)), 2);
    ELSE
      _tax_amount := round(_taxable * _tax.rate / 100, 2);
    END IF;

    INSERT INTO public.order_taxes(order_id, tax_id, name_snapshot, rate_snapshot, amount)
      VALUES (_order_id, _tax.id, _tax.name, _tax.rate, _tax_amount);
  END LOOP;

  UPDATE public.orders
    SET discount_total = _discount_total,
        tax_total = _tax_total,
        grand_total = _grand,
        payment_status = _new_status,
        status = CASE WHEN _new_status = 'paid' THEN 'completed'::order_status ELSE status END,
        completed_at = CASE WHEN _new_status = 'paid' AND completed_at IS NULL THEN now() ELSE completed_at END,
        updated_at = now()
    WHERE id = _order_id;

  INSERT INTO public.audit_log(restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
    VALUES (
      _restaurant, _order.branch_id, _user, 'order', _order_id, 'discount_adjusted',
      jsonb_build_object(
        'order_no', _order.order_no,
        'old_discount_total', _order.discount_total,
        'new_discount_total', _discount_total,
        'old_grand_total', _order.grand_total,
        'new_grand_total', _grand,
        'amount_paid', _order.amount_paid,
        'reason', NULLIF(trim(_reason), '')
      )
    );

  order_id := _order_id;
  order_no := _order.order_no;
  new_grand_total := _grand;
  new_payment_status := _new_status;
  RETURN NEXT;
END
$function$;

GRANT EXECUTE ON FUNCTION public.adjust_order_discount(uuid, numeric, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.adjust_order_discount(uuid, numeric, text) FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';
