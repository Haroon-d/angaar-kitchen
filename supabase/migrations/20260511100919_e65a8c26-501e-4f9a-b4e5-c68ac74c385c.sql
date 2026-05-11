-- 1. Currency defaults
ALTER TABLE public.restaurants ALTER COLUMN currency SET DEFAULT 'PKR';
ALTER TABLE public.restaurants ALTER COLUMN currency_symbol SET DEFAULT '₨';
ALTER TABLE public.restaurants ALTER COLUMN timezone SET DEFAULT 'Asia/Karachi';
UPDATE public.restaurants SET currency='PKR', currency_symbol='₨', timezone='Asia/Karachi'
  WHERE currency='INR' OR currency_symbol='₹';

-- 2. Order status enum: add voided / refunded (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='public.order_status'::regtype AND enumlabel='voided') THEN
    ALTER TYPE public.order_status ADD VALUE 'voided';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='public.order_status'::regtype AND enumlabel='refunded') THEN
    ALTER TYPE public.order_status ADD VALUE 'refunded';
  END IF;
END $$;

-- 3. Idempotency key on orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS orders_branch_idempotency_uk
  ON public.orders(branch_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS orders_branch_created_idx ON public.orders(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON public.orders(branch_id, status);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS order_taxes_order_idx ON public.order_taxes(order_id);
CREATE INDEX IF NOT EXISTS payments_order_idx ON public.payments(order_id);
CREATE INDEX IF NOT EXISTS menu_items_branch_avail_idx ON public.menu_items(branch_id, is_available);
CREATE INDEX IF NOT EXISTS menu_items_category_idx ON public.menu_items(category_id, sort_order);
CREATE INDEX IF NOT EXISTS menu_categories_branch_idx ON public.menu_categories(branch_id, sort_order);

-- 5. created_by trigger (defensive)
CREATE OR REPLACE FUNCTION public.set_order_created_by()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_orders_created_by ON public.orders;
CREATE TRIGGER trg_orders_created_by BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_order_created_by();

-- 6. Audit log
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  entity text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_restaurant_created_idx ON public.audit_log(restaurant_id, created_at DESC);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_admin_select ON public.audit_log;
CREATE POLICY audit_admin_select ON public.audit_log FOR SELECT
  USING (public.is_restaurant_admin(auth.uid(), restaurant_id));

-- 7. Atomic POS order RPC (server-side totals + idempotency)
CREATE OR REPLACE FUNCTION public.create_pos_order(
  _branch uuid,
  _dining_type public.dining_type,
  _customer_name text,
  _customer_phone text,
  _table_label text,
  _discount numeric,
  _payment_method public.payment_method,
  _items jsonb,                -- [{item_id uuid, qty int, notes text?}]
  _idempotency_key uuid
) RETURNS TABLE (order_id uuid, order_no text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _restaurant uuid;
  _existing record;
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
  _new_item_id uuid;
  _tax record;
  _tax_amount numeric(12,2);
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.can_access_branch(_user, _branch) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'cart empty'; END IF;

  SELECT restaurant_id, code INTO _restaurant, _branch_code FROM public.branches WHERE id = _branch;

  -- Idempotency: return existing if same key already used
  IF _idempotency_key IS NOT NULL THEN
    SELECT id, order_no INTO _existing FROM public.orders
      WHERE branch_id = _branch AND idempotency_key = _idempotency_key LIMIT 1;
    IF FOUND THEN
      order_id := _existing.id; order_no := _existing.order_no; RETURN NEXT; RETURN;
    END IF;
  END IF;

  -- Compute subtotal from authoritative DB prices
  FOR _line IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := COALESCE((_line->>'qty')::int, 0);
    IF _qty <= 0 THEN CONTINUE; END IF;
    SELECT id, name, base_price, branch_id, is_available INTO _item
      FROM public.menu_items WHERE id = (_line->>'item_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'item not found: %', _line->>'item_id'; END IF;
    IF _item.branch_id <> _branch THEN RAISE EXCEPTION 'item % not in branch', _item.id; END IF;
    IF NOT _item.is_available THEN RAISE EXCEPTION 'item % unavailable', _item.name; END IF;
    _subtotal := _subtotal + (_item.base_price * _qty);
  END LOOP;

  _discount_total := GREATEST(0, LEAST(COALESCE(_discount,0), _subtotal));
  _taxable := _subtotal - _discount_total;

  -- Tax pass 1: compute total
  FOR _tax IN SELECT id, name, rate, is_inclusive FROM public.taxes
    WHERE restaurant_id = _restaurant AND is_active AND apply_by_default
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
    DO UPDATE SET last_seq = order_counters.last_seq + 1
    RETURNING last_seq INTO _seq;
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
    SELECT id, name, base_price INTO _item FROM public.menu_items WHERE id = (_line->>'item_id')::uuid;
    _line_total := _item.base_price * _qty;
    INSERT INTO public.order_items(order_id, item_id, name_snapshot, unit_price, qty, line_subtotal, notes)
      VALUES (_order_id, _item.id, _item.name, _item.base_price, _qty, _line_total, NULLIF(_line->>'notes',''));
  END LOOP;

  -- Insert taxes
  FOR _tax IN SELECT id, name, rate, is_inclusive FROM public.taxes
    WHERE restaurant_id = _restaurant AND is_active AND apply_by_default
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

  order_id := _order_id; order_no := _order_no;
  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.create_pos_order(uuid, public.dining_type, text, text, text, numeric, public.payment_method, jsonb, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_pos_order(uuid, public.dining_type, text, text, text, numeric, public.payment_method, jsonb, uuid) TO authenticated;