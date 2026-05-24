-- Recipe learning standards.
-- Allows ingredients to be linked before the standard quantity is known, then
-- learns a conservative standard from multiple closed stock count sessions.

ALTER TABLE public.inventory_recipes
  DROP CONSTRAINT IF EXISTS inventory_recipes_quantity_check;

ALTER TABLE public.inventory_recipes
  ADD CONSTRAINT inventory_recipes_quantity_check CHECK (quantity >= 0);

ALTER TABLE public.inventory_recipes
  ADD COLUMN IF NOT EXISTS standard_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS learning_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_calibrated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_calibrated_session_count integer;

ALTER TABLE public.inventory_recipes
  DROP CONSTRAINT IF EXISTS inventory_recipes_standard_source_check;

ALTER TABLE public.inventory_recipes
  ADD CONSTRAINT inventory_recipes_standard_source_check
  CHECK (standard_source IN ('manual', 'learning', 'learned'));

DROP FUNCTION IF EXISTS public.get_recipe_usage_calibration(uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_recipe_usage_calibration(
  _menu_item_id uuid,
  _session_id uuid
) RETURNS TABLE(
  inventory_item_id uuid,
  ingredient_name text,
  unit text,
  sold_qty numeric,
  standard_qty numeric,
  theoretical_qty numeric,
  ingredient_total_theoretical_qty numeric,
  actual_usage_qty numeric,
  allocated_actual_qty numeric,
  observed_qty_per_item numeric,
  variance_qty_per_item numeric,
  variance_cost_per_item numeric,
  average_cost numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _session record;
  _menu record;
  _start_at timestamptz;
  _end_at timestamptz;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _menu_item_id IS NULL THEN RAISE EXCEPTION 'menu item required'; END IF;
  IF _session_id IS NULL THEN RAISE EXCEPTION 'session required'; END IF;

  SELECT scs.*
    INTO _session
    FROM public.stock_count_sessions scs
    WHERE scs.id = _session_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'stock count session not found'; END IF;
  IF NOT public.can_access_branch(_user, _session.branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT mi.id, mi.branch_id, mi.name
    INTO _menu
    FROM public.menu_items mi
    WHERE mi.id = _menu_item_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'menu item not found'; END IF;
  IF _menu.branch_id <> _session.branch_id THEN RAISE EXCEPTION 'menu item not in session branch'; END IF;

  _start_at := (_session.business_date::timestamp AT TIME ZONE 'Asia/Karachi');
  _end_at := ((_session.business_date + 1)::timestamp AT TIME ZONE 'Asia/Karachi');

  RETURN QUERY
  WITH selected_sales AS (
    SELECT COALESCE(sum(oi.qty), 0)::numeric AS sold_qty
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE o.branch_id = _session.branch_id
        AND o.created_at >= _start_at
        AND o.created_at < _end_at
        AND o.status NOT IN ('cancelled', 'voided', 'refunded')
        AND oi.item_id = _menu_item_id
  ),
  ingredient_activity AS (
    SELECT
      ir.inventory_item_id,
      count(DISTINCT oi.item_id) FILTER (WHERE oi.qty > 0) AS linked_sold_item_count,
      sum(ir.quantity * oi.qty)::numeric AS ingredient_total_theoretical_qty,
      sum(CASE WHEN oi.item_id = _menu_item_id THEN ir.quantity * oi.qty ELSE 0 END)::numeric AS selected_theoretical_qty
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.inventory_recipes ir ON ir.menu_item_id = oi.item_id
    WHERE o.branch_id = _session.branch_id
      AND o.created_at >= _start_at
      AND o.created_at < _end_at
      AND o.status NOT IN ('cancelled', 'voided', 'refunded')
    GROUP BY ir.inventory_item_id
  ),
  movements AS (
    SELECT
      im.inventory_item_id,
      sum(CASE WHEN im.movement_type = 'purchase' THEN im.quantity_delta ELSE 0 END) AS purchased_qty,
      sum(CASE WHEN im.movement_type IN ('waste', 'damage', 'staff_meal') THEN -1 * im.quantity_delta ELSE 0 END) AS waste_qty
    FROM public.inventory_movements im
    WHERE im.branch_id = _session.branch_id
      AND im.created_at >= _start_at
      AND im.created_at < _end_at
    GROUP BY im.inventory_item_id
  ),
  actual AS (
    SELECT
      scl.inventory_item_id,
      CASE
        WHEN scl.opening_qty IS NULL OR scl.closing_qty IS NULL THEN NULL
        ELSE round(scl.opening_qty + COALESCE(m.purchased_qty, 0) - COALESCE(m.waste_qty, 0) - scl.closing_qty, 3)
      END::numeric AS actual_usage_qty
    FROM public.stock_count_lines scl
    LEFT JOIN movements m ON m.inventory_item_id = scl.inventory_item_id
    WHERE scl.session_id = _session_id
  ),
  calculated AS (
    SELECT
      ir.inventory_item_id,
      ii.name AS ingredient_name,
      ii.base_unit::text AS unit,
      ss.sold_qty,
      round(ir.quantity, 3)::numeric AS standard_qty,
      round(ir.quantity * ss.sold_qty, 3)::numeric AS theoretical_qty,
      round(COALESCE(ia.ingredient_total_theoretical_qty, 0), 3)::numeric AS ingredient_total_theoretical_qty,
      a.actual_usage_qty,
      CASE
        WHEN a.actual_usage_qty IS NULL OR ss.sold_qty <= 0 THEN NULL
        WHEN COALESCE(ia.ingredient_total_theoretical_qty, 0) > 0
          AND COALESCE(ia.selected_theoretical_qty, 0) > 0 THEN
            round(a.actual_usage_qty * (ia.selected_theoretical_qty / ia.ingredient_total_theoretical_qty), 3)
        WHEN COALESCE(ia.linked_sold_item_count, 0) = 1 THEN
            round(a.actual_usage_qty, 3)
        ELSE NULL
      END::numeric AS allocated_actual_qty,
      ii.average_cost
    FROM public.inventory_recipes ir
    JOIN public.inventory_items ii ON ii.id = ir.inventory_item_id
    CROSS JOIN selected_sales ss
    LEFT JOIN ingredient_activity ia ON ia.inventory_item_id = ir.inventory_item_id
    LEFT JOIN actual a ON a.inventory_item_id = ir.inventory_item_id
    WHERE ir.menu_item_id = _menu_item_id
  )
  SELECT
    c.inventory_item_id,
    c.ingredient_name,
    c.unit,
    c.sold_qty,
    c.standard_qty,
    c.theoretical_qty,
    c.ingredient_total_theoretical_qty,
    c.actual_usage_qty,
    c.allocated_actual_qty,
    CASE
      WHEN c.allocated_actual_qty IS NULL OR c.sold_qty <= 0 THEN NULL
      ELSE round(c.allocated_actual_qty / c.sold_qty, 3)
    END::numeric AS observed_qty_per_item,
    CASE
      WHEN c.allocated_actual_qty IS NULL OR c.sold_qty <= 0 THEN NULL
      ELSE round((c.allocated_actual_qty / c.sold_qty) - c.standard_qty, 3)
    END::numeric AS variance_qty_per_item,
    CASE
      WHEN c.allocated_actual_qty IS NULL OR c.sold_qty <= 0 THEN NULL
      ELSE round(((c.allocated_actual_qty / c.sold_qty) - c.standard_qty) * c.average_cost, 2)
    END::numeric AS variance_cost_per_item,
    c.average_cost
  FROM calculated c
  ORDER BY c.ingredient_name;
END
$function$;

CREATE OR REPLACE FUNCTION public.learn_recipe_quantity_from_history(
  _menu_item_id uuid,
  _inventory_item_id uuid,
  _lookback_days integer DEFAULT 30,
  _min_sessions integer DEFAULT 3
) RETURNS TABLE(
  menu_item_id uuid,
  inventory_item_id uuid,
  learned_qty numeric,
  sample_count integer,
  average_qty numeric,
  min_qty numeric,
  max_qty numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _menu record;
  _ingredient record;
  _restaurant uuid;
  _learned numeric(14,3);
  _average numeric(14,3);
  _min numeric(14,3);
  _max numeric(14,3);
  _samples integer;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _menu_item_id IS NULL THEN RAISE EXCEPTION 'menu item required'; END IF;
  IF _inventory_item_id IS NULL THEN RAISE EXCEPTION 'ingredient required'; END IF;
  _lookback_days := GREATEST(1, COALESCE(_lookback_days, 30));
  _min_sessions := GREATEST(1, COALESCE(_min_sessions, 3));

  SELECT mi.id, mi.branch_id, mi.name
    INTO _menu
    FROM public.menu_items mi
    WHERE mi.id = _menu_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'menu item not found'; END IF;

  SELECT ii.id, ii.branch_id, ii.name
    INTO _ingredient
    FROM public.inventory_items ii
    WHERE ii.id = _inventory_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ingredient not found'; END IF;
  IF _ingredient.branch_id <> _menu.branch_id THEN RAISE EXCEPTION 'ingredient not in menu branch'; END IF;
  IF NOT public.can_manage_branch(_user, _menu.branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.inventory_recipes ir
      WHERE ir.menu_item_id = _menu_item_id
        AND ir.inventory_item_id = _inventory_item_id
  ) THEN
    RAISE EXCEPTION 'save this ingredient in the recipe before learning its standard';
  END IF;

  SELECT b.restaurant_id INTO _restaurant
    FROM public.branches b
    WHERE b.id = _menu.branch_id;
  IF _restaurant IS NULL THEN RAISE EXCEPTION 'branch not found'; END IF;

  WITH candidate_sessions AS (
    SELECT scs.*
      FROM public.stock_count_sessions scs
      WHERE scs.branch_id = _menu.branch_id
        AND scs.status = 'closed'
        AND scs.business_date >= CURRENT_DATE - _lookback_days
  ),
  session_usage AS (
    SELECT
      scs.id AS session_id,
      ss.sold_qty,
      actual.actual_usage_qty,
      activity.linked_sold_item_count,
      activity.ingredient_total_theoretical_qty,
      activity.selected_theoretical_qty
    FROM candidate_sessions scs
    JOIN LATERAL (
      SELECT COALESCE(sum(oi.qty), 0)::numeric AS sold_qty
        FROM public.order_items oi
        JOIN public.orders o ON o.id = oi.order_id
        WHERE o.branch_id = _menu.branch_id
          AND o.created_at >= (scs.business_date::timestamp AT TIME ZONE 'Asia/Karachi')
          AND o.created_at < ((scs.business_date + 1)::timestamp AT TIME ZONE 'Asia/Karachi')
          AND o.status NOT IN ('cancelled', 'voided', 'refunded')
          AND oi.item_id = _menu_item_id
    ) ss ON true
    JOIN LATERAL (
      SELECT
        count(DISTINCT oi.item_id) FILTER (WHERE oi.qty > 0) AS linked_sold_item_count,
        sum(ir.quantity * oi.qty)::numeric AS ingredient_total_theoretical_qty,
        sum(CASE WHEN oi.item_id = _menu_item_id THEN ir.quantity * oi.qty ELSE 0 END)::numeric AS selected_theoretical_qty
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      JOIN public.inventory_recipes ir ON ir.menu_item_id = oi.item_id
      WHERE o.branch_id = _menu.branch_id
        AND o.created_at >= (scs.business_date::timestamp AT TIME ZONE 'Asia/Karachi')
        AND o.created_at < ((scs.business_date + 1)::timestamp AT TIME ZONE 'Asia/Karachi')
        AND o.status NOT IN ('cancelled', 'voided', 'refunded')
        AND ir.inventory_item_id = _inventory_item_id
    ) activity ON true
    JOIN LATERAL (
      WITH movements AS (
        SELECT
          sum(CASE WHEN im.movement_type = 'purchase' THEN im.quantity_delta ELSE 0 END) AS purchased_qty,
          sum(CASE WHEN im.movement_type IN ('waste', 'damage', 'staff_meal') THEN -1 * im.quantity_delta ELSE 0 END) AS waste_qty
        FROM public.inventory_movements im
        WHERE im.branch_id = _menu.branch_id
          AND im.inventory_item_id = _inventory_item_id
          AND im.created_at >= (scs.business_date::timestamp AT TIME ZONE 'Asia/Karachi')
          AND im.created_at < ((scs.business_date + 1)::timestamp AT TIME ZONE 'Asia/Karachi')
      )
      SELECT
        CASE
          WHEN scl.opening_qty IS NULL OR scl.closing_qty IS NULL THEN NULL
          ELSE round(scl.opening_qty + COALESCE(m.purchased_qty, 0) - COALESCE(m.waste_qty, 0) - scl.closing_qty, 3)
        END::numeric AS actual_usage_qty
      FROM public.stock_count_lines scl
      CROSS JOIN movements m
      WHERE scl.session_id = scs.id
        AND scl.inventory_item_id = _inventory_item_id
    ) actual ON true
    WHERE ss.sold_qty > 0
      AND actual.actual_usage_qty > 0
  ),
  observed AS (
    SELECT
      CASE
        WHEN COALESCE(ingredient_total_theoretical_qty, 0) > 0
          AND COALESCE(selected_theoretical_qty, 0) > 0 THEN
            (actual_usage_qty * (selected_theoretical_qty / ingredient_total_theoretical_qty)) / sold_qty
        WHEN COALESCE(linked_sold_item_count, 0) = 1 THEN
            actual_usage_qty / sold_qty
        ELSE NULL
      END::numeric AS observed_qty_per_item
    FROM session_usage
  ),
  usable AS (
    SELECT observed_qty_per_item
      FROM observed
      WHERE observed_qty_per_item IS NOT NULL
        AND observed_qty_per_item > 0
  )
  SELECT
    round((percentile_cont(0.5) WITHIN GROUP (ORDER BY observed_qty_per_item))::numeric, 3),
    round(avg(observed_qty_per_item), 3),
    round(min(observed_qty_per_item), 3),
    round(max(observed_qty_per_item), 3),
    count(*)::integer
    INTO _learned, _average, _min, _max, _samples
    FROM usable;

  IF COALESCE(_samples, 0) < _min_sessions THEN
    RAISE EXCEPTION 'not enough clear closing days to learn standard: found %, need %', COALESCE(_samples, 0), _min_sessions;
  END IF;

  UPDATE public.inventory_recipes ir
    SET quantity = _learned,
        standard_source = 'learned',
        learning_enabled = true,
        last_calibrated_at = now(),
        last_calibrated_session_count = _samples
    WHERE ir.menu_item_id = _menu_item_id
      AND ir.inventory_item_id = _inventory_item_id;

  INSERT INTO public.audit_log(restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
    VALUES (
      _restaurant, _menu.branch_id, _user, 'inventory_recipe', _menu_item_id, 'learned_standard',
      jsonb_build_object(
        'inventory_item_id', _inventory_item_id,
        'learned_qty', _learned,
        'sample_count', _samples,
        'lookback_days', _lookback_days,
        'min_sessions', _min_sessions
      )
    );

  menu_item_id := _menu_item_id;
  inventory_item_id := _inventory_item_id;
  learned_qty := _learned;
  sample_count := _samples;
  average_qty := _average;
  min_qty := _min;
  max_qty := _max;
  RETURN NEXT;
END
$function$;

GRANT EXECUTE ON FUNCTION public.get_recipe_usage_calibration(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.learn_recipe_quantity_from_history(uuid, uuid, integer, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_recipe_usage_calibration(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.learn_recipe_quantity_from_history(uuid, uuid, integer, integer) FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';
