-- Phase 1: Split Order / Payment / Print domains

-- 1) Payment status enum + column
DO $$ BEGIN
  CREATE TYPE public.payment_status_t AS ENUM ('pending','partial','paid','refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_status public.payment_status_t NOT NULL DEFAULT 'pending';

-- Backfill: anything previously completed with amount_paid >= grand_total is 'paid'
UPDATE public.orders
   SET payment_status = 'paid'
 WHERE payment_status = 'pending'
   AND grand_total > 0
   AND amount_paid >= grand_total;

-- 2) Print bookkeeping
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS kot_print_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bill_print_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS receipt_print_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_printed_at timestamptz;

-- 3) Refactor create_pos_order: NO payment, NO completion. Order is placed only.
CREATE OR REPLACE FUNCTION public.create_pos_order(
  _branch uuid,
  _dining_type dining_type,
  _customer_name text,
  _customer_phone text,
  _table_label text,
  _discount numeric,
  _items jsonb,
  _idempotency_key uuid
) RETURNS TABLE(order_id uuid, order_no text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

  SELECT b.restaurant_id, b.code INTO _restaurant, _branch_code
    FROM public.branches AS b WHERE b.id = _branch;
  IF _restaurant IS NULL THEN RAISE EXCEPTION 'branch not found'; END IF;

  -- Idempotency
  IF _idempotency_key IS NOT NULL THEN
    SELECT o.id, o.order_no INTO _existing_order_id, _existing_order_no
      FROM public.orders AS o
      WHERE o.branch_id = _branch AND o.idempotency_key = _idempotency_key
      LIMIT 1;
    IF FOUND THEN
      order_id := _existing_order_id;
      order_no := _existing_order_no;
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  -- Subtotal
  FOR _line IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := COALESCE((_line->>'qty')::int, 0);
    IF _qty <= 0 THEN CONTINUE; END IF;
    SELECT mi.id, mi.name, mi.base_price, mi.branch_id, mi.is_available INTO _item
      FROM public.menu_items AS mi WHERE mi.id = (_line->>'item_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'item not found: %', _line->>'item_id'; END IF;
    IF _item.branch_id <> _branch THEN RAISE EXCEPTION 'item % not in branch', _item.id; END IF;
    IF NOT _item.is_available THEN RAISE EXCEPTION 'item % unavailable', _item.name; END IF;
    _subtotal := _subtotal + (_item.base_price * _qty);
  END LOOP;

  _discount_total := GREATEST(0, LEAST(COALESCE(_discount,0), _subtotal));
  _taxable := _subtotal - _discount_total;

  FOR _tax IN
    SELECT t.id, t.name, t.rate, t.is_inclusive FROM public.taxes AS t
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

  INSERT INTO public.order_counters(branch_id, counter_date, last_seq)
    VALUES (_branch, _today, 1)
    ON CONFLICT (branch_id, counter_date)
    DO UPDATE SET last_seq = public.order_counters.last_seq + 1
    RETURNING public.order_counters.last_seq INTO _seq;

  _order_no := 'AK-' || COALESCE(_branch_code,'BR') || '-' || to_char(_today,'YYYYMMDD') || '-' || lpad(_seq::text, 4, '0');

  -- NOTE: status='open', payment_status='pending', no payment row, no completed_at
  INSERT INTO public.orders(
    id, branch_id, order_no, dining_type, status, payment_status,
    customer_name, customer_phone, table_label,
    subtotal, discount_total, tax_total, grand_total, amount_paid,
    created_by, idempotency_key
  ) VALUES (
    _order_id, _branch, _order_no, _dining_type, 'open', 'pending',
    NULLIF(trim(_customer_name),''), NULLIF(trim(_customer_phone),''),
    CASE WHEN _dining_type='dine_in' THEN NULLIF(trim(_table_label),'') END,
    _subtotal, _discount_total, _tax_total, _grand, 0,
    _user, _idempotency_key
  );

  FOR _line IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := COALESCE((_line->>'qty')::int, 0);
    IF _qty <= 0 THEN CONTINUE; END IF;
    SELECT mi.id, mi.name, mi.base_price INTO _item
      FROM public.menu_items AS mi WHERE mi.id = (_line->>'item_id')::uuid;
    _line_total := _item.base_price * _qty;
    INSERT INTO public.order_items(order_id, item_id, name_snapshot, unit_price, qty, line_subtotal, notes)
      VALUES (_order_id, _item.id, _item.name, _item.base_price, _qty, _line_total, NULLIF(_line->>'notes',''));
  END LOOP;

  FOR _tax IN
    SELECT t.id, t.name, t.rate, t.is_inclusive FROM public.taxes AS t
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

  INSERT INTO public.audit_log(restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
    VALUES (_restaurant, _branch, _user, 'order', _order_id, 'placed',
            jsonb_build_object('order_no', _order_no, 'grand_total', _grand));

  order_id := _order_id;
  order_no := _order_no;
  RETURN NEXT;
END $function$;

-- 4) record_payment: separate domain
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

  SELECT o.id, o.branch_id, o.grand_total, o.amount_paid, o.payment_status
    INTO _order FROM public.orders o WHERE o.id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF NOT public.can_access_branch(_user, _order.branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
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

-- 5) record_print: log + counters
CREATE OR REPLACE FUNCTION public.record_print(
  _order_id uuid,
  _kind text  -- 'kot' | 'bill' | 'receipt'
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _order record;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _kind NOT IN ('kot','bill','receipt') THEN RAISE EXCEPTION 'invalid print kind'; END IF;

  SELECT o.id, o.branch_id INTO _order FROM public.orders o WHERE o.id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
  IF NOT public.can_access_branch(_user, _order.branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

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

-- 6) Drop old signature of create_pos_order (with _payment_method) so PostgREST picks new one
DROP FUNCTION IF EXISTS public.create_pos_order(uuid, dining_type, text, text, text, numeric, payment_method, jsonb, uuid);
