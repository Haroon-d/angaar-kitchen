-- Inventory purchase maintenance helpers.
-- These keep stock updates transactional when a manager edits or deletes a purchase.

CREATE OR REPLACE FUNCTION public.delete_inventory_purchase(_purchase uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _purchase_row public.inventory_purchases%ROWTYPE;
  _restaurant uuid;
  _line record;
  _item record;
  _before numeric(14,3);
  _after numeric(14,3);
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT * INTO _purchase_row
  FROM public.inventory_purchases
  WHERE id = _purchase
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'purchase not found'; END IF;
  IF NOT public.can_manage_branch(_user, _purchase_row.branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT restaurant_id INTO _restaurant FROM public.branches WHERE id = _purchase_row.branch_id;

  FOR _line IN
    SELECT *
    FROM public.inventory_purchase_lines
    WHERE purchase_id = _purchase
    ORDER BY id
  LOOP
    SELECT * INTO _item
    FROM public.inventory_items
    WHERE id = _line.inventory_item_id
    FOR UPDATE;

    IF FOUND THEN
      _before := _item.current_qty;
      _after := round(_before - _line.base_quantity, 3);

      UPDATE public.inventory_items
      SET current_qty = _after
      WHERE id = _item.id;

      INSERT INTO public.inventory_movements(
        branch_id, inventory_item_id, movement_type, reason, quantity_delta,
        before_qty, after_qty, unit_cost, related_purchase_id, actor_id, note
      ) VALUES (
        _purchase_row.branch_id, _item.id, 'correction', 'correction', -_line.base_quantity,
        _before, _after, _line.unit_cost, _purchase, _user,
        concat('Purchase deleted', COALESCE(': ' || _purchase_row.invoice_no, ''))
      );
    END IF;
  END LOOP;

  DELETE FROM public.inventory_purchases WHERE id = _purchase;

  INSERT INTO public.audit_log(restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
  VALUES (
    _restaurant, _purchase_row.branch_id, _user, 'inventory_purchase', _purchase, 'deleted',
    jsonb_build_object('invoice_no', _purchase_row.invoice_no, 'total', _purchase_row.total)
  );
END $function$;

CREATE OR REPLACE FUNCTION public.update_inventory_purchase(
  _purchase uuid,
  _supplier uuid,
  _invoice_no text,
  _purchase_date date,
  _notes text,
  _lines jsonb
) RETURNS TABLE(purchase_id uuid, total numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _purchase_row public.inventory_purchases%ROWTYPE;
  _restaurant uuid;
  _old_line record;
  _line jsonb;
  _item record;
  _qty numeric(14,3);
  _unit public.inventory_unit;
  _pack_size numeric(14,3);
  _base_qty numeric(14,3);
  _unit_cost numeric(14,4);
  _line_total numeric(14,2);
  _total numeric(14,2) := 0;
  _new_avg numeric(14,6);
  _before numeric(14,3);
  _after numeric(14,3);
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _lines IS NULL OR jsonb_array_length(_lines) = 0 THEN RAISE EXCEPTION 'purchase needs at least one line'; END IF;

  SELECT * INTO _purchase_row
  FROM public.inventory_purchases
  WHERE id = _purchase
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'purchase not found'; END IF;
  IF NOT public.can_manage_branch(_user, _purchase_row.branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT restaurant_id INTO _restaurant FROM public.branches WHERE id = _purchase_row.branch_id;
  IF _restaurant IS NULL THEN RAISE EXCEPTION 'branch not found'; END IF;

  IF _supplier IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.suppliers s WHERE s.id = _supplier AND s.restaurant_id = _restaurant
  ) THEN
    RAISE EXCEPTION 'supplier not found';
  END IF;

  FOR _old_line IN
    SELECT *
    FROM public.inventory_purchase_lines
    WHERE purchase_id = _purchase
    ORDER BY id
  LOOP
    SELECT * INTO _item
    FROM public.inventory_items
    WHERE id = _old_line.inventory_item_id
    FOR UPDATE;

    IF FOUND THEN
      _before := _item.current_qty;
      _after := round(_before - _old_line.base_quantity, 3);

      UPDATE public.inventory_items
      SET current_qty = _after
      WHERE id = _item.id;

      INSERT INTO public.inventory_movements(
        branch_id, inventory_item_id, movement_type, reason, quantity_delta,
        before_qty, after_qty, unit_cost, related_purchase_id, actor_id, note
      ) VALUES (
        _purchase_row.branch_id, _item.id, 'correction', 'correction', -_old_line.base_quantity,
        _before, _after, _old_line.unit_cost, _purchase, _user,
        concat('Purchase edited reversal', COALESCE(': ' || _purchase_row.invoice_no, ''))
      );
    END IF;
  END LOOP;

  DELETE FROM public.inventory_purchase_lines WHERE purchase_id = _purchase;

  UPDATE public.inventory_purchases
  SET supplier_id = _supplier,
      invoice_no = NULLIF(trim(_invoice_no), ''),
      purchase_date = COALESCE(_purchase_date, CURRENT_DATE),
      notes = NULLIF(trim(_notes), ''),
      total = 0
  WHERE id = _purchase;

  FOR _line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    SELECT * INTO _item
      FROM public.inventory_items
      WHERE id = (_line->>'inventory_item_id')::uuid AND branch_id = _purchase_row.branch_id
      FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'inventory item not found'; END IF;

    _qty := COALESCE((_line->>'quantity')::numeric, 0);
    _unit := (_line->>'unit')::public.inventory_unit;
    _pack_size := NULLIF(_line->>'pack_size', '')::numeric;
    _unit_cost := COALESCE((_line->>'unit_cost')::numeric, 0);
    _base_qty := public.inventory_convert_to_base(_unit, _item.base_unit, _qty, _pack_size);
    _line_total := round(_qty * _unit_cost, 2);
    _before := _item.current_qty;
    _after := round(_before + _base_qty, 3);
    _new_avg := CASE
      WHEN _after > 0 THEN round(((_item.current_qty * _item.average_cost) + _line_total) / _after, 6)
      ELSE _item.average_cost
    END;

    INSERT INTO public.inventory_purchase_lines(purchase_id, inventory_item_id, quantity, unit, pack_size, base_quantity, unit_cost, line_total)
    VALUES (_purchase, _item.id, _qty, _unit, _pack_size, _base_qty, _unit_cost, _line_total);

    UPDATE public.inventory_items
      SET current_qty = _after, average_cost = _new_avg
      WHERE id = _item.id;

    INSERT INTO public.inventory_movements(
      branch_id, inventory_item_id, movement_type, reason, quantity_delta,
      before_qty, after_qty, unit_cost, related_purchase_id, actor_id, note
    ) VALUES (
      _purchase_row.branch_id, _item.id, 'purchase', 'purchase', _base_qty,
      _before, _after, CASE WHEN _base_qty > 0 THEN round(_line_total / _base_qty, 6) ELSE 0 END,
      _purchase, _user, NULLIF(trim(_notes), '')
    );

    _total := _total + _line_total;
  END LOOP;

  UPDATE public.inventory_purchases SET total = _total WHERE id = _purchase;

  INSERT INTO public.audit_log(restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
  VALUES (_restaurant, _purchase_row.branch_id, _user, 'inventory_purchase', _purchase, 'edited', jsonb_build_object('total', _total));

  purchase_id := _purchase;
  total := _total;
  RETURN NEXT;
END $function$;

GRANT EXECUTE ON FUNCTION public.delete_inventory_purchase(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_inventory_purchase(uuid, uuid, text, date, text, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_inventory_purchase(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_inventory_purchase(uuid, uuid, text, date, text, jsonb) FROM PUBLIC, anon;
