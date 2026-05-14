-- Inventory system: branch-level ingredients, purchases, recipes, stock movements.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_unit') THEN
    CREATE TYPE public.inventory_unit AS ENUM ('g', 'kg', 'ml', 'l', 'piece', 'pack');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_base_unit') THEN
    CREATE TYPE public.inventory_base_unit AS ENUM ('g', 'ml', 'piece');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_movement_type') THEN
    CREATE TYPE public.inventory_movement_type AS ENUM ('purchase', 'sale', 'adjustment', 'waste', 'correction', 'staff_meal', 'damage');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_adjustment_reason') THEN
    CREATE TYPE public.inventory_adjustment_reason AS ENUM ('purchase', 'sale', 'waste', 'damage', 'correction', 'staff_meal', 'other');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text,
  base_unit public.inventory_base_unit NOT NULL,
  current_qty numeric(14,3) NOT NULL DEFAULT 0,
  reorder_level numeric(14,3) NOT NULL DEFAULT 0,
  average_cost numeric(14,6) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_items_qty_finite CHECK (current_qty > -1000000000),
  CONSTRAINT inventory_items_reorder_nonnegative CHECK (reorder_level >= 0),
  CONSTRAINT inventory_items_average_cost_nonnegative CHECK (average_cost >= 0)
);
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS inventory_items_updated_at ON public.inventory_items;
CREATE TRIGGER inventory_items_updated_at BEFORE UPDATE ON public.inventory_items
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE INDEX IF NOT EXISTS inventory_items_branch_idx ON public.inventory_items(branch_id, is_active, name);

CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  email text,
  address text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS suppliers_updated_at ON public.suppliers;
CREATE TRIGGER suppliers_updated_at BEFORE UPDATE ON public.suppliers
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE INDEX IF NOT EXISTS suppliers_restaurant_idx ON public.suppliers(restaurant_id, is_active, name);

CREATE TABLE IF NOT EXISTS public.inventory_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  invoice_no text,
  purchase_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  total numeric(14,2) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_purchases ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS inventory_purchases_branch_idx ON public.inventory_purchases(branch_id, purchase_date DESC);

CREATE TABLE IF NOT EXISTS public.inventory_purchase_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.inventory_purchases(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit public.inventory_unit NOT NULL,
  pack_size numeric(14,3),
  base_quantity numeric(14,3) NOT NULL CHECK (base_quantity > 0),
  unit_cost numeric(14,4) NOT NULL CHECK (unit_cost >= 0),
  line_total numeric(14,2) NOT NULL CHECK (line_total >= 0)
);
ALTER TABLE public.inventory_purchase_lines ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS inventory_purchase_lines_purchase_idx ON public.inventory_purchase_lines(purchase_id);
CREATE INDEX IF NOT EXISTS inventory_purchase_lines_item_idx ON public.inventory_purchase_lines(inventory_item_id);

CREATE TABLE IF NOT EXISTS public.inventory_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(menu_item_id, inventory_item_id)
);
ALTER TABLE public.inventory_recipes ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS inventory_recipes_updated_at ON public.inventory_recipes;
CREATE TRIGGER inventory_recipes_updated_at BEFORE UPDATE ON public.inventory_recipes
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE INDEX IF NOT EXISTS inventory_recipes_menu_item_idx ON public.inventory_recipes(menu_item_id);
CREATE INDEX IF NOT EXISTS inventory_recipes_inventory_item_idx ON public.inventory_recipes(inventory_item_id);

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  movement_type public.inventory_movement_type NOT NULL,
  reason public.inventory_adjustment_reason,
  quantity_delta numeric(14,3) NOT NULL,
  before_qty numeric(14,3) NOT NULL,
  after_qty numeric(14,3) NOT NULL,
  unit_cost numeric(14,6) NOT NULL DEFAULT 0,
  related_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  related_purchase_id uuid REFERENCES public.inventory_purchases(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS inventory_movements_branch_created_idx ON public.inventory_movements(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_movements_item_created_idx ON public.inventory_movements(inventory_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_movements_order_idx ON public.inventory_movements(related_order_id);

CREATE OR REPLACE FUNCTION public.inventory_convert_to_base(
  _unit public.inventory_unit,
  _base_unit public.inventory_base_unit,
  _quantity numeric,
  _pack_size numeric DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
BEGIN
  IF _quantity IS NULL OR _quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be greater than zero';
  END IF;

  IF _unit = 'kg' THEN
    IF _base_unit <> 'g' THEN RAISE EXCEPTION 'kg can only be used for gram-based items'; END IF;
    RETURN round(_quantity * 1000, 3);
  ELSIF _unit = 'g' THEN
    IF _base_unit <> 'g' THEN RAISE EXCEPTION 'g can only be used for gram-based items'; END IF;
    RETURN round(_quantity, 3);
  ELSIF _unit = 'l' THEN
    IF _base_unit <> 'ml' THEN RAISE EXCEPTION 'l can only be used for ml-based items'; END IF;
    RETURN round(_quantity * 1000, 3);
  ELSIF _unit = 'ml' THEN
    IF _base_unit <> 'ml' THEN RAISE EXCEPTION 'ml can only be used for ml-based items'; END IF;
    RETURN round(_quantity, 3);
  ELSIF _unit = 'piece' THEN
    IF _base_unit <> 'piece' THEN RAISE EXCEPTION 'piece can only be used for piece-based items'; END IF;
    RETURN round(_quantity, 3);
  ELSIF _unit = 'pack' THEN
    IF _pack_size IS NULL OR _pack_size <= 0 THEN RAISE EXCEPTION 'pack size is required for pack purchases'; END IF;
    RETURN round(_quantity * _pack_size, 3);
  END IF;

  RAISE EXCEPTION 'unsupported unit';
END $function$;

CREATE OR REPLACE FUNCTION public.record_inventory_purchase(
  _branch uuid,
  _invoice_no text,
  _lines jsonb,
  _notes text,
  _purchase_date date,
  _supplier uuid
) RETURNS TABLE(purchase_id uuid, total numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _purchase_id uuid := gen_random_uuid();
  _restaurant uuid;
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
  IF NOT public.can_manage_branch(_user, _branch) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _lines IS NULL OR jsonb_array_length(_lines) = 0 THEN RAISE EXCEPTION 'purchase needs at least one line'; END IF;

  SELECT restaurant_id INTO _restaurant FROM public.branches WHERE id = _branch;
  IF _restaurant IS NULL THEN RAISE EXCEPTION 'branch not found'; END IF;
  IF _supplier IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.suppliers s WHERE s.id = _supplier AND s.restaurant_id = _restaurant
  ) THEN
    RAISE EXCEPTION 'supplier not found';
  END IF;

  INSERT INTO public.inventory_purchases(id, branch_id, supplier_id, invoice_no, purchase_date, notes, total, created_by)
  VALUES (_purchase_id, _branch, _supplier, NULLIF(trim(_invoice_no), ''), COALESCE(_purchase_date, CURRENT_DATE), NULLIF(trim(_notes), ''), 0, _user);

  FOR _line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    SELECT * INTO _item
      FROM public.inventory_items
      WHERE id = (_line->>'inventory_item_id')::uuid AND branch_id = _branch
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
    VALUES (_purchase_id, _item.id, _qty, _unit, _pack_size, _base_qty, _unit_cost, _line_total);

    UPDATE public.inventory_items
      SET current_qty = _after, average_cost = _new_avg
      WHERE id = _item.id;

    INSERT INTO public.inventory_movements(
      branch_id, inventory_item_id, movement_type, reason, quantity_delta,
      before_qty, after_qty, unit_cost, related_purchase_id, actor_id, note
    ) VALUES (
      _branch, _item.id, 'purchase', 'purchase', _base_qty,
      _before, _after, CASE WHEN _base_qty > 0 THEN round(_line_total / _base_qty, 6) ELSE 0 END,
      _purchase_id, _user, NULLIF(trim(_notes), '')
    );

    _total := _total + _line_total;
  END LOOP;

  UPDATE public.inventory_purchases SET total = _total WHERE id = _purchase_id;

  INSERT INTO public.audit_log(restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
  VALUES (_restaurant, _branch, _user, 'inventory_purchase', _purchase_id, 'recorded', jsonb_build_object('total', _total));

  purchase_id := _purchase_id;
  total := _total;
  RETURN NEXT;
END $function$;

CREATE OR REPLACE FUNCTION public.record_inventory_adjustment(
  _item uuid,
  _movement_type public.inventory_movement_type,
  _reason public.inventory_adjustment_reason,
  _quantity_delta numeric,
  _note text
) RETURNS TABLE(movement_id uuid, new_quantity numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _row record;
  _before numeric(14,3);
  _after numeric(14,3);
  _movement_id uuid := gen_random_uuid();
  _restaurant uuid;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _quantity_delta IS NULL OR _quantity_delta = 0 THEN RAISE EXCEPTION 'quantity delta cannot be zero'; END IF;
  IF _movement_type NOT IN ('adjustment', 'waste', 'correction', 'staff_meal', 'damage') THEN
    RAISE EXCEPTION 'invalid adjustment type';
  END IF;

  SELECT ii.*, b.restaurant_id INTO _row
    FROM public.inventory_items ii
    JOIN public.branches b ON b.id = ii.branch_id
    WHERE ii.id = _item
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'inventory item not found'; END IF;
  IF NOT public.can_manage_branch(_user, _row.branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  _before := _row.current_qty;
  _after := round(_before + _quantity_delta, 3);
  _restaurant := _row.restaurant_id;

  UPDATE public.inventory_items SET current_qty = _after WHERE id = _item;

  INSERT INTO public.inventory_movements(
    id, branch_id, inventory_item_id, movement_type, reason, quantity_delta,
    before_qty, after_qty, unit_cost, actor_id, note
  ) VALUES (
    _movement_id, _row.branch_id, _item, _movement_type, _reason, round(_quantity_delta, 3),
    _before, _after, _row.average_cost, _user, NULLIF(trim(_note), '')
  );

  INSERT INTO public.audit_log(restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
  VALUES (_restaurant, _row.branch_id, _user, 'inventory', _item, 'adjusted', jsonb_build_object('delta', _quantity_delta, 'reason', _reason));

  movement_id := _movement_id;
  new_quantity := _after;
  RETURN NEXT;
END $function$;

CREATE OR REPLACE FUNCTION public.get_menu_item_stock_status(_branch uuid)
RETURNS TABLE(
  item_id uuid,
  missing_recipe boolean,
  is_low boolean,
  is_negative boolean,
  limiting_inventory_item_id uuid,
  limiting_inventory_item_name text,
  max_possible_qty numeric,
  recipe_cost numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH recipe_rows AS (
    SELECT
      mi.id AS menu_item_id,
      ir.inventory_item_id,
      ii.name AS inventory_item_name,
      ii.current_qty,
      ii.reorder_level,
      ii.average_cost,
      ir.quantity,
      floor(ii.current_qty / NULLIF(ir.quantity, 0))::numeric AS possible_qty
    FROM public.menu_items mi
    LEFT JOIN public.inventory_recipes ir ON ir.menu_item_id = mi.id
    LEFT JOIN public.inventory_items ii ON ii.id = ir.inventory_item_id
    WHERE mi.branch_id = _branch
  ),
  ranked AS (
    SELECT *,
      row_number() OVER (PARTITION BY menu_item_id ORDER BY possible_qty NULLS LAST, inventory_item_name) AS rn
    FROM recipe_rows
    WHERE inventory_item_id IS NOT NULL
  )
  SELECT
    mi.id AS item_id,
    NOT EXISTS (SELECT 1 FROM public.inventory_recipes ir WHERE ir.menu_item_id = mi.id) AS missing_recipe,
    COALESCE(bool_or(rr.current_qty <= rr.reorder_level), false) AS is_low,
    COALESCE(bool_or(rr.current_qty < 0), false) AS is_negative,
    r.inventory_item_id AS limiting_inventory_item_id,
    r.inventory_item_name AS limiting_inventory_item_name,
    CASE WHEN r.inventory_item_id IS NULL THEN NULL ELSE r.possible_qty END AS max_possible_qty,
    COALESCE(sum(rr.quantity * rr.average_cost), 0)::numeric AS recipe_cost
  FROM public.menu_items mi
  LEFT JOIN recipe_rows rr ON rr.menu_item_id = mi.id
  LEFT JOIN ranked r ON r.menu_item_id = mi.id AND r.rn = 1
  WHERE mi.branch_id = _branch
    AND public.can_access_branch(auth.uid(), _branch)
  GROUP BY mi.id, r.inventory_item_id, r.inventory_item_name, r.possible_qty;
$function$;

CREATE OR REPLACE VIEW public.inventory_low_stock AS
SELECT
  ii.*,
  b.restaurant_id,
  (ii.current_qty <= ii.reorder_level) AS is_low,
  (ii.current_qty < 0) AS is_negative,
  round(ii.current_qty * ii.average_cost, 2) AS stock_value
FROM public.inventory_items ii
JOIN public.branches b ON b.id = ii.branch_id
WHERE ii.is_active AND ii.current_qty <= ii.reorder_level;

CREATE OR REPLACE VIEW public.inventory_food_cost_by_menu_item AS
SELECT
  mi.id AS menu_item_id,
  mi.branch_id,
  mi.name,
  mi.base_price,
  COALESCE(sum(ir.quantity * ii.average_cost), 0)::numeric AS recipe_cost,
  round(mi.base_price - COALESCE(sum(ir.quantity * ii.average_cost), 0), 2) AS gross_margin,
  CASE WHEN mi.base_price > 0
    THEN round((COALESCE(sum(ir.quantity * ii.average_cost), 0) / mi.base_price) * 100, 2)
    ELSE 0
  END AS food_cost_percent
FROM public.menu_items mi
LEFT JOIN public.inventory_recipes ir ON ir.menu_item_id = mi.id
LEFT JOIN public.inventory_items ii ON ii.id = ir.inventory_item_id
GROUP BY mi.id, mi.branch_id, mi.name, mi.base_price;

GRANT SELECT ON public.inventory_low_stock TO authenticated;
GRANT SELECT ON public.inventory_food_cost_by_menu_item TO authenticated;

-- RLS policies. Drop first so this migration can be safely rerun from SQL Editor
-- if a previous manual attempt only applied part of the file.
DROP POLICY IF EXISTS inventory_items_member_select ON public.inventory_items;
DROP POLICY IF EXISTS inventory_items_manager_all ON public.inventory_items;
DROP POLICY IF EXISTS suppliers_member_select ON public.suppliers;
DROP POLICY IF EXISTS suppliers_admin_all ON public.suppliers;
DROP POLICY IF EXISTS inventory_purchases_member_select ON public.inventory_purchases;
DROP POLICY IF EXISTS inventory_purchases_manager_all ON public.inventory_purchases;
DROP POLICY IF EXISTS inventory_purchase_lines_member_select ON public.inventory_purchase_lines;
DROP POLICY IF EXISTS inventory_purchase_lines_manager_all ON public.inventory_purchase_lines;
DROP POLICY IF EXISTS inventory_recipes_member_select ON public.inventory_recipes;
DROP POLICY IF EXISTS inventory_recipes_manager_all ON public.inventory_recipes;
DROP POLICY IF EXISTS inventory_movements_member_select ON public.inventory_movements;
DROP POLICY IF EXISTS inventory_movements_manager_all ON public.inventory_movements;

CREATE POLICY inventory_items_member_select ON public.inventory_items
  FOR SELECT TO authenticated
  USING (public.can_access_branch(auth.uid(), branch_id));
CREATE POLICY inventory_items_manager_all ON public.inventory_items
  FOR ALL TO authenticated
  USING (public.can_manage_branch(auth.uid(), branch_id))
  WITH CHECK (public.can_manage_branch(auth.uid(), branch_id));

CREATE POLICY suppliers_member_select ON public.suppliers
  FOR SELECT TO authenticated
  USING (public.is_restaurant_member(auth.uid(), restaurant_id));
CREATE POLICY suppliers_admin_all ON public.suppliers
  FOR ALL TO authenticated
  USING (
    public.is_restaurant_admin(auth.uid(), restaurant_id)
    OR public.has_role_in_restaurant(auth.uid(), restaurant_id, 'manager')
  )
  WITH CHECK (
    public.is_restaurant_admin(auth.uid(), restaurant_id)
    OR public.has_role_in_restaurant(auth.uid(), restaurant_id, 'manager')
  );

CREATE POLICY inventory_purchases_member_select ON public.inventory_purchases
  FOR SELECT TO authenticated
  USING (public.can_access_branch(auth.uid(), branch_id));
CREATE POLICY inventory_purchases_manager_all ON public.inventory_purchases
  FOR ALL TO authenticated
  USING (public.can_manage_branch(auth.uid(), branch_id))
  WITH CHECK (public.can_manage_branch(auth.uid(), branch_id));

CREATE POLICY inventory_purchase_lines_member_select ON public.inventory_purchase_lines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.inventory_purchases p
    WHERE p.id = purchase_id AND public.can_access_branch(auth.uid(), p.branch_id)
  ));
CREATE POLICY inventory_purchase_lines_manager_all ON public.inventory_purchase_lines
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.inventory_purchases p
    WHERE p.id = purchase_id AND public.can_manage_branch(auth.uid(), p.branch_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.inventory_purchases p
    WHERE p.id = purchase_id AND public.can_manage_branch(auth.uid(), p.branch_id)
  ));

CREATE POLICY inventory_recipes_member_select ON public.inventory_recipes
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.menu_items mi
    WHERE mi.id = menu_item_id AND public.can_access_branch(auth.uid(), mi.branch_id)
  ));
CREATE POLICY inventory_recipes_manager_all ON public.inventory_recipes
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.menu_items mi
    WHERE mi.id = menu_item_id AND public.can_manage_branch(auth.uid(), mi.branch_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.menu_items mi
    WHERE mi.id = menu_item_id AND public.can_manage_branch(auth.uid(), mi.branch_id)
  ));

CREATE POLICY inventory_movements_member_select ON public.inventory_movements
  FOR SELECT TO authenticated
  USING (public.can_access_branch(auth.uid(), branch_id));
CREATE POLICY inventory_movements_manager_all ON public.inventory_movements
  FOR ALL TO authenticated
  USING (public.can_manage_branch(auth.uid(), branch_id))
  WITH CHECK (public.can_manage_branch(auth.uid(), branch_id));

-- Replace create_pos_order with inventory deduction on first successful placement.
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
  _recipe record;
  _before numeric(14,3);
  _after numeric(14,3);
  _delta numeric(14,3);
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.can_access_branch(_user, _branch) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'cart empty'; END IF;

  SELECT b.restaurant_id, b.code INTO _restaurant, _branch_code
    FROM public.branches AS b WHERE b.id = _branch;
  IF _restaurant IS NULL THEN RAISE EXCEPTION 'branch not found'; END IF;

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

    FOR _recipe IN
      SELECT ir.inventory_item_id, ir.quantity, ii.current_qty, ii.average_cost, ii.branch_id
      FROM public.inventory_recipes ir
      JOIN public.inventory_items ii ON ii.id = ir.inventory_item_id
      WHERE ir.menu_item_id = _item.id
      FOR UPDATE OF ii
    LOOP
      IF _recipe.branch_id <> _branch THEN
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
        _branch, _recipe.inventory_item_id, 'sale', 'sale', _delta,
        _before, _after, _recipe.average_cost, _order_id, _user, _order_no
      );
    END LOOP;
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

GRANT EXECUTE ON FUNCTION public.record_inventory_purchase(uuid, text, jsonb, text, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_inventory_adjustment(uuid, public.inventory_movement_type, public.inventory_adjustment_reason, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_menu_item_stock_status(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.record_inventory_purchase(uuid, text, jsonb, text, date, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_inventory_adjustment(uuid, public.inventory_movement_type, public.inventory_adjustment_reason, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_menu_item_stock_status(uuid) FROM PUBLIC, anon;

-- Tell Supabase PostgREST to refresh its schema cache immediately.
NOTIFY pgrst, 'reload schema';
