CREATE OR REPLACE FUNCTION public.create_pos_order(_branch uuid, _dining_type dining_type, _customer_name text, _customer_phone text, _table_label text, _discount numeric, _payment_method payment_method, _items jsonb, _idempotency_key uuid)
 RETURNS TABLE(order_id uuid, order_no text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _restaurant uuid;
  _existing_order_id uuid;
  _existing_order_no text;
  _order_id uuid := gen_random_uuid();
  _order_no text;
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _seq int;
  _branch_code text;
  _subtotal numeric(12,2) := 0;
  _discount_total numeric(12,2);
  _taxable numeric(12,2);
  _tax_total numeric(12,2) := 0;
  _grand numeric(12,2);
  _user uuid := auth.uid();
  _line jsonb;
  _item record;
  _qty int;
  _line_total numeric(12,2);
  _tax record;
  _tax_amount numeric(12,2);
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.can_access_branch(_user, _branch) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'cart empty'; END IF;

  SELECT b.restaurant_id, b.code
    INTO _restaurant, _branch_code
    FROM public.branches AS b
    WHERE b.id = _branch;

  IF _restaurant IS NULL THEN RAISE EXCEPTION 'branch not found'; END IF;

  -- Idempotency: return existing if same key already used
  IF _idempotency_key IS NOT NULL THEN
    SELECT o.id, o.order_no
      INTO _existing_order_id, _existing_order_no
      FROM public.orders AS o
      WHERE o.branch_id = _branch AND o.idempotency_key = _idempotency_key
      LIMIT 1;

    IF FOUND THEN
      order_id := _existing_order_id;
      order_no := _existing_order_no;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- Compute subtotal from authoritative DB prices
  FOR _line IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := COALESCE((_line->>'qty')::int, 0);
    IF _qty <= 0 THEN CONTINUE; END IF;

    SELECT mi.id, mi.name, mi.base_price, mi.branch_id, mi.is_available
      INTO _item
      FROM public.menu_items AS mi
      WHERE mi.id = (_line->>'item_id')::uuid;

    IF NOT FOUND THEN RAISE EXCEPTION 'item not found: %', _line->>'item_id'; END IF;
    IF _item.branch_id <> _branch THEN RAISE EXCEPTION 'item % not in branch', _item.id; END IF;
    IF NOT _item.is_available THEN RAISE EXCEPTION 'item % unavailable', _item.name; END IF;

    _subtotal := _subtotal + (_item.base_price * _qty);
  END LOOP;

  _discount_total := GREATEST(0, LEAST(COALESCE(_discount,0), _subtotal));
  _taxable := _subtotal - _discount_total;

  -- Tax pass 1: compute total
  FOR _tax IN
    SELECT t.id, t.name, t.rate, t.is_inclusive
      FROM public.taxes AS t
      WHERE t.restaurant_id = _restaurant AND t.is_active AND t.apply_by_default
  LOOP
    IF _tax.is_inclusive THEN
      _tax_amount := round(_taxable - (_taxable / (1 + _tax.rate/100)), 2);
    ELSE
      _tax_amount := round(_taxable * _tax.rate / 100, 2);
      _tax_total := _tax_total + _tax_amount;
    END IF;
  END LOOP;

  _grand := round(_taxable + _tax_total, 2);

  -- Order number
  INSERT INTO public.order_counters(branch_id, counter_date, last_seq)
    VALUES (_branch, _today, 1)
    ON CONFLICT (branch_id, counter_date)
    DO UPDATE SET last_seq = public.order_counters.last_seq + 1
    RETURNING public.order_counters.last_seq INTO _seq;

  _order_no := 'AK-' || COALESCE(_branch_code,'BR') || '-' || to_char(_today,'YYYYMMDD') || '-' || lpad(_seq::text, 4, '0');

  -- Insert order
  INSERT INTO public.orders(
    id, branch_id, order_no, dining_type, status, customer_name, customer_phone,
    table_label, subtotal, discount_total, tax_total, grand_total, amount_paid,
    created_by, completed_at, idempotency_key
  ) VALUES (
    _order_id, _branch, _order_no, _dining_type, 'completed',
    NULLIF(trim(_customer_name),''), NULLIF(trim(_customer_phone),''),
    CASE WHEN _dining_type='dine_in' THEN NULLIF(trim(_table_label),'') END,
    _subtotal, _discount_total, _tax_total, _grand, _grand,
    _user, now(), _idempotency_key
  );

  -- Insert items
  FOR _line IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := COALESCE((_line->>'qty')::int, 0);
    IF _qty <= 0 THEN CONTINUE; END IF;

    SELECT mi.id, mi.name, mi.base_price
      INTO _item
      FROM public.menu_items AS mi
      WHERE mi.id = (_line->>'item_id')::uuid;

    _line_total := _item.base_price * _qty;

    INSERT INTO public.order_items(order_id, item_id, name_snapshot, unit_price, qty, line_subtotal, notes)
      VALUES (_order_id, _item.id, _item.name, _item.base_price, _qty, _line_total, NULLIF(_line->>'notes',''));
  END LOOP;

  -- Insert taxes
  FOR _tax IN
    SELECT t.id, t.name, t.rate, t.is_inclusive
      FROM public.taxes AS t
      WHERE t.restaurant_id = _restaurant AND t.is_active AND t.apply_by_default
  LOOP
    IF _tax.is_inclusive THEN
      _tax_amount := round(_taxable - (_taxable / (1 + _tax.rate/100)), 2);
    ELSE
      _tax_amount := round(_taxable * _tax.rate / 100, 2);
    END IF;

    INSERT INTO public.order_taxes(order_id, tax_id, name_snapshot, rate_snapshot, amount)
      VALUES (_order_id, _tax.id, _tax.name, _tax.rate, _tax_amount);
  END LOOP;

  -- Insert payment
  INSERT INTO public.payments(order_id, method, amount, received_by)
    VALUES (_order_id, _payment_method, _grand, _user);

  -- Audit
  INSERT INTO public.audit_log(restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
    VALUES (_restaurant, _branch, _user, 'order', _order_id, 'created',
            jsonb_build_object('order_no', _order_no, 'grand_total', _grand));

  order_id := _order_id;
  order_no := _order_no;
  RETURN NEXT;
END
$function$;