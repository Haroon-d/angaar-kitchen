-- Order editing for unpaid live orders.
-- Keeps order history intact and uses net inventory movements so repeated edits stay balanced.

CREATE OR REPLACE FUNCTION public.cancel_order(_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _order record;
  _net record;
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
  IF _order.status = 'completed' THEN RAISE EXCEPTION 'completed orders cannot be cancelled'; END IF;
  IF _order.status IN ('cancelled', 'voided', 'refunded') THEN
    RAISE EXCEPTION 'order is already %', _order.status;
  END IF;
  IF _order.payment_status <> 'pending' OR COALESCE(_order.amount_paid, 0) > 0 THEN
    RAISE EXCEPTION 'paid or partially paid orders must be refunded before cancellation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = _order_id) THEN
    RAISE EXCEPTION 'orders with payment records cannot be cancelled';
  END IF;

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

    _reverse_delta := round(-1 * _net.net_delta, 3);
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
      _before, _after, COALESCE(_item.average_cost, 0),
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

CREATE OR REPLACE FUNCTION public.update_pos_order(
  _order_id uuid,
  _dining_type dining_type,
  _customer_name text,
  _customer_phone text,
  _table_label text,
  _discount numeric,
  _items jsonb
) RETURNS TABLE(order_id uuid, order_no text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _order record;
  _restaurant uuid;
  _line jsonb;
  _item record;
  _qty int;
  _valid_lines int := 0;
  _subtotal numeric(12,2) := 0;
  _discount_total numeric(12,2);
  _taxable numeric(12,2);
  _tax_total numeric(12,2) := 0;
  _grand numeric(12,2);
  _old_grand numeric(12,2);
  _line_total numeric(12,2);
  _tax record;
  _tax_amount numeric(12,2);
  _recipe record;
  _net record;
  _before numeric(14,3);
  _after numeric(14,3);
  _delta numeric(14,3);
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'cart empty'; END IF;

  SELECT o.id, o.branch_id, o.order_no, o.status, o.payment_status, o.amount_paid, o.grand_total
    INTO _order
    FROM public.orders o
    WHERE o.id = _order_id
    FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF NOT public.can_manage_branch(_user, _order.branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _order.status IN ('completed', 'cancelled', 'voided', 'refunded') THEN
    RAISE EXCEPTION 'cannot edit % order', _order.status;
  END IF;
  IF _order.payment_status <> 'pending' OR COALESCE(_order.amount_paid, 0) > 0 THEN
    RAISE EXCEPTION 'paid or partially paid orders cannot be edited';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = _order_id) THEN
    RAISE EXCEPTION 'orders with payment records cannot be edited';
  END IF;

  SELECT b.restaurant_id INTO _restaurant
    FROM public.branches b
    WHERE b.id = _order.branch_id;
  IF _restaurant IS NULL THEN RAISE EXCEPTION 'branch not found'; END IF;

  FOR _line IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := COALESCE((_line->>'qty')::int, 0);
    IF _qty <= 0 THEN CONTINUE; END IF;
    _valid_lines := _valid_lines + 1;

    SELECT mi.id, mi.name, mi.base_price, mi.branch_id, mi.is_available
      INTO _item
      FROM public.menu_items mi
      WHERE mi.id = (_line->>'item_id')::uuid;

    IF NOT FOUND THEN RAISE EXCEPTION 'item not found: %', _line->>'item_id'; END IF;
    IF _item.branch_id <> _order.branch_id THEN RAISE EXCEPTION 'item % not in branch', _item.id; END IF;
    IF NOT _item.is_available THEN RAISE EXCEPTION 'item % unavailable', _item.name; END IF;

    _subtotal := _subtotal + (_item.base_price * _qty);
  END LOOP;

  IF _valid_lines = 0 THEN RAISE EXCEPTION 'cart empty'; END IF;

  _discount_total := GREATEST(0, LEAST(COALESCE(_discount, 0), _subtotal));
  _taxable := _subtotal - _discount_total;

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
  _old_grand := _order.grand_total;

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

    IF NOT FOUND THEN RAISE EXCEPTION 'inventory item not found for order edit reversal'; END IF;

    _delta := round(-1 * _net.net_delta, 3);
    _before := _item.current_qty;
    _after := round(_before + _delta, 3);

    UPDATE public.inventory_items SET current_qty = _after WHERE id = _item.id;
    INSERT INTO public.inventory_movements(
      branch_id, inventory_item_id, movement_type, reason, quantity_delta,
      before_qty, after_qty, unit_cost, related_order_id, actor_id, note
    ) VALUES (
      _order.branch_id, _item.id, 'correction', 'correction', _delta,
      _before, _after, COALESCE(_item.average_cost, 0), _order_id, _user,
      concat('Edited order ', _order.order_no, ' stock reversal')
    );
  END LOOP;

  DELETE FROM public.order_item_addons
    WHERE order_item_id IN (SELECT oi.id FROM public.order_items oi WHERE oi.order_id = _order_id);
  DELETE FROM public.order_items WHERE order_id = _order_id;
  DELETE FROM public.order_taxes WHERE order_id = _order_id;

  UPDATE public.orders
    SET dining_type = _dining_type,
        customer_name = NULLIF(trim(_customer_name), ''),
        customer_phone = NULLIF(trim(_customer_phone), ''),
        table_label = CASE WHEN _dining_type = 'dine_in' THEN NULLIF(trim(_table_label), '') END,
        subtotal = _subtotal,
        discount_total = _discount_total,
        tax_total = _tax_total,
        grand_total = _grand,
        updated_at = now()
    WHERE id = _order_id;

  FOR _line IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := COALESCE((_line->>'qty')::int, 0);
    IF _qty <= 0 THEN CONTINUE; END IF;

    SELECT mi.id, mi.name, mi.base_price
      INTO _item
      FROM public.menu_items mi
      WHERE mi.id = (_line->>'item_id')::uuid;

    _line_total := _item.base_price * _qty;
    INSERT INTO public.order_items(order_id, item_id, name_snapshot, unit_price, qty, line_subtotal, notes)
      VALUES (_order_id, _item.id, _item.name, _item.base_price, _qty, _line_total, NULLIF(_line->>'notes', ''));

    FOR _recipe IN
      SELECT ir.inventory_item_id, ir.quantity, ii.current_qty, ii.average_cost, ii.branch_id
        FROM public.inventory_recipes ir
        JOIN public.inventory_items ii ON ii.id = ir.inventory_item_id
        WHERE ir.menu_item_id = _item.id
        FOR UPDATE OF ii
    LOOP
      IF _recipe.branch_id <> _order.branch_id THEN
        RAISE EXCEPTION 'recipe ingredient belongs to a different branch';
      END IF;

      _delta := round(-1 * _recipe.quantity * _qty, 3);
      _before := _recipe.current_qty;
      _after := round(_before + _delta, 3);

      UPDATE public.inventory_items SET current_qty = _after WHERE id = _recipe.inventory_item_id;
      INSERT INTO public.inventory_movements(
        branch_id, inventory_item_id, movement_type, reason, quantity_delta,
        before_qty, after_qty, unit_cost, related_order_id, actor_id, note
      ) VALUES (
        _order.branch_id, _recipe.inventory_item_id, 'sale', 'sale', _delta,
        _before, _after, _recipe.average_cost, _order_id, _user,
        concat(_order.order_no, ' edited')
      );
    END LOOP;
  END LOOP;

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

  INSERT INTO public.audit_log(restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
    VALUES (
      _restaurant, _order.branch_id, _user, 'order', _order_id, 'edited',
      jsonb_build_object('order_no', _order.order_no, 'old_grand_total', _old_grand, 'new_grand_total', _grand)
    );

  order_id := _order_id;
  order_no := _order.order_no;
  RETURN NEXT;
END
$function$;

GRANT EXECUTE ON FUNCTION public.cancel_order(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_pos_order(uuid, dining_type, text, text, text, numeric, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.update_pos_order(uuid, dining_type, text, text, text, numeric, jsonb) FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';
