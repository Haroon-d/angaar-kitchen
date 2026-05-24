-- Recipe usage calibration.
-- Compares recipe standards with observed usage from a closed stock count session.

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
  all_ingredient_theory AS (
    SELECT
      ir.inventory_item_id,
      sum(ir.quantity * oi.qty)::numeric AS ingredient_total_theoretical_qty
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
  )
  SELECT
    ir.inventory_item_id,
    ii.name AS ingredient_name,
    ii.base_unit::text AS unit,
    ss.sold_qty,
    round(ir.quantity, 3)::numeric AS standard_qty,
    round(ir.quantity * ss.sold_qty, 3)::numeric AS theoretical_qty,
    round(COALESCE(ait.ingredient_total_theoretical_qty, 0), 3)::numeric AS ingredient_total_theoretical_qty,
    a.actual_usage_qty,
    CASE
      WHEN a.actual_usage_qty IS NULL OR COALESCE(ait.ingredient_total_theoretical_qty, 0) <= 0 THEN NULL
      ELSE round(a.actual_usage_qty * ((ir.quantity * ss.sold_qty) / ait.ingredient_total_theoretical_qty), 3)
    END::numeric AS allocated_actual_qty,
    CASE
      WHEN a.actual_usage_qty IS NULL
        OR ss.sold_qty <= 0
        OR COALESCE(ait.ingredient_total_theoretical_qty, 0) <= 0 THEN NULL
      ELSE round((a.actual_usage_qty * ((ir.quantity * ss.sold_qty) / ait.ingredient_total_theoretical_qty)) / ss.sold_qty, 3)
    END::numeric AS observed_qty_per_item,
    CASE
      WHEN a.actual_usage_qty IS NULL
        OR ss.sold_qty <= 0
        OR COALESCE(ait.ingredient_total_theoretical_qty, 0) <= 0 THEN NULL
      ELSE round(((a.actual_usage_qty * ((ir.quantity * ss.sold_qty) / ait.ingredient_total_theoretical_qty)) / ss.sold_qty) - ir.quantity, 3)
    END::numeric AS variance_qty_per_item,
    CASE
      WHEN a.actual_usage_qty IS NULL
        OR ss.sold_qty <= 0
        OR COALESCE(ait.ingredient_total_theoretical_qty, 0) <= 0 THEN NULL
      ELSE round((((a.actual_usage_qty * ((ir.quantity * ss.sold_qty) / ait.ingredient_total_theoretical_qty)) / ss.sold_qty) - ir.quantity) * ii.average_cost, 2)
    END::numeric AS variance_cost_per_item,
    ii.average_cost
  FROM public.inventory_recipes ir
  JOIN public.inventory_items ii ON ii.id = ir.inventory_item_id
  CROSS JOIN selected_sales ss
  LEFT JOIN all_ingredient_theory ait ON ait.inventory_item_id = ir.inventory_item_id
  LEFT JOIN actual a ON a.inventory_item_id = ir.inventory_item_id
  WHERE ir.menu_item_id = _menu_item_id
  ORDER BY ii.name;
END
$function$;

GRANT EXECUTE ON FUNCTION public.get_recipe_usage_calibration(uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_recipe_usage_calibration(uuid, uuid) FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';
