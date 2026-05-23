-- Daily item accountability report.
-- Gives the dashboard one audited source for menu quantities sold and inventory consumed.

CREATE OR REPLACE FUNCTION public.get_item_usage_report(
  _branch_id uuid,
  _start_at timestamptz,
  _end_at timestamptz
) RETURNS TABLE(
  report_type text,
  item_id uuid,
  item_name text,
  category text,
  unit text,
  quantity numeric,
  completed_quantity numeric,
  active_quantity numeric,
  revenue numeric,
  cost numeric,
  order_count integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _branch_id IS NULL THEN RAISE EXCEPTION 'branch required'; END IF;
  IF _start_at IS NULL OR _end_at IS NULL OR _end_at <= _start_at THEN
    RAISE EXCEPTION 'invalid report range';
  END IF;
  IF NOT public.can_access_branch(_user, _branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  SELECT
    'menu_item'::text AS report_type,
    oi.item_id,
    oi.name_snapshot AS item_name,
    mc.name AS category,
    'qty'::text AS unit,
    sum(oi.qty)::numeric AS quantity,
    sum(CASE WHEN o.status = 'completed' THEN oi.qty ELSE 0 END)::numeric AS completed_quantity,
    sum(CASE WHEN o.status <> 'completed' THEN oi.qty ELSE 0 END)::numeric AS active_quantity,
    round(sum(oi.line_subtotal), 2)::numeric AS revenue,
    0::numeric AS cost,
    count(DISTINCT o.id)::integer AS order_count
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  LEFT JOIN public.menu_items mi ON mi.id = oi.item_id
  LEFT JOIN public.menu_categories mc ON mc.id = mi.category_id
  WHERE o.branch_id = _branch_id
    AND o.created_at >= _start_at
    AND o.created_at < _end_at
    AND o.status NOT IN ('cancelled', 'voided', 'refunded')
  GROUP BY oi.item_id, oi.name_snapshot, mc.name
  HAVING sum(oi.qty) <> 0

  UNION ALL

  SELECT
    'inventory_item'::text AS report_type,
    ii.id AS item_id,
    ii.name AS item_name,
    ii.category,
    ii.base_unit::text AS unit,
    round(-1 * sum(im.quantity_delta), 3)::numeric AS quantity,
    round(-1 * sum(CASE WHEN o.status = 'completed' THEN im.quantity_delta ELSE 0 END), 3)::numeric AS completed_quantity,
    round(-1 * sum(CASE WHEN o.status <> 'completed' THEN im.quantity_delta ELSE 0 END), 3)::numeric AS active_quantity,
    0::numeric AS revenue,
    round(sum(-1 * im.quantity_delta * im.unit_cost), 2)::numeric AS cost,
    count(DISTINCT o.id)::integer AS order_count
  FROM public.inventory_movements im
  JOIN public.inventory_items ii ON ii.id = im.inventory_item_id
  JOIN public.orders o ON o.id = im.related_order_id
  WHERE im.branch_id = _branch_id
    AND o.created_at >= _start_at
    AND o.created_at < _end_at
    AND o.status NOT IN ('cancelled', 'voided', 'refunded')
    AND im.movement_type IN ('sale', 'correction')
  GROUP BY ii.id, ii.name, ii.category, ii.base_unit
  HAVING round(-1 * sum(im.quantity_delta), 3) <> 0
  ORDER BY report_type, quantity DESC, item_name;
END
$function$;

GRANT EXECUTE ON FUNCTION public.get_item_usage_report(uuid, timestamptz, timestamptz) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_item_usage_report(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';
