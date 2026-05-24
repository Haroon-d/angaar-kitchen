-- Daily stock reconciliation.
-- Tracks opening/closing physical counts and compares actual usage with recipe usage.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stock_count_session_status') THEN
    CREATE TYPE public.stock_count_session_status AS ENUM ('open', 'closed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.stock_count_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  status public.stock_count_session_status NOT NULL DEFAULT 'open',
  opened_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(branch_id, business_date)
);

ALTER TABLE public.stock_count_sessions ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS stock_count_sessions_updated_at ON public.stock_count_sessions;
CREATE TRIGGER stock_count_sessions_updated_at BEFORE UPDATE ON public.stock_count_sessions
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE INDEX IF NOT EXISTS stock_count_sessions_branch_date_idx
  ON public.stock_count_sessions(branch_id, business_date DESC);

CREATE TABLE IF NOT EXISTS public.stock_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.stock_count_sessions(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  opening_qty numeric(14,3),
  closing_qty numeric(14,3),
  opening_note text,
  closing_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, inventory_item_id),
  CONSTRAINT stock_count_lines_opening_nonnegative CHECK (opening_qty IS NULL OR opening_qty >= 0),
  CONSTRAINT stock_count_lines_closing_nonnegative CHECK (closing_qty IS NULL OR closing_qty >= 0)
);

ALTER TABLE public.stock_count_lines ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS stock_count_lines_updated_at ON public.stock_count_lines;
CREATE TRIGGER stock_count_lines_updated_at BEFORE UPDATE ON public.stock_count_lines
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE INDEX IF NOT EXISTS stock_count_lines_session_idx ON public.stock_count_lines(session_id);
CREATE INDEX IF NOT EXISTS stock_count_lines_item_idx ON public.stock_count_lines(inventory_item_id);

DROP POLICY IF EXISTS stock_count_sessions_member_select ON public.stock_count_sessions;
DROP POLICY IF EXISTS stock_count_sessions_manager_all ON public.stock_count_sessions;
DROP POLICY IF EXISTS stock_count_lines_member_select ON public.stock_count_lines;
DROP POLICY IF EXISTS stock_count_lines_manager_all ON public.stock_count_lines;

CREATE POLICY stock_count_sessions_member_select ON public.stock_count_sessions
FOR SELECT USING (public.can_access_branch(auth.uid(), branch_id));

CREATE POLICY stock_count_sessions_manager_all ON public.stock_count_sessions
FOR ALL USING (public.can_manage_branch(auth.uid(), branch_id))
WITH CHECK (public.can_manage_branch(auth.uid(), branch_id));

CREATE POLICY stock_count_lines_member_select ON public.stock_count_lines
FOR SELECT USING (
  EXISTS (
    SELECT 1
      FROM public.stock_count_sessions scs
      WHERE scs.id = session_id
        AND public.can_access_branch(auth.uid(), scs.branch_id)
  )
);

CREATE POLICY stock_count_lines_manager_all ON public.stock_count_lines
FOR ALL USING (
  EXISTS (
    SELECT 1
      FROM public.stock_count_sessions scs
      WHERE scs.id = session_id
        AND public.can_manage_branch(auth.uid(), scs.branch_id)
  )
) WITH CHECK (
  EXISTS (
    SELECT 1
      FROM public.stock_count_sessions scs
      WHERE scs.id = session_id
        AND public.can_manage_branch(auth.uid(), scs.branch_id)
  )
);

CREATE OR REPLACE FUNCTION public.open_stock_count_session(
  _branch_id uuid,
  _business_date date DEFAULT CURRENT_DATE,
  _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _session_id uuid;
  _restaurant uuid;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _branch_id IS NULL THEN RAISE EXCEPTION 'branch required'; END IF;
  IF NOT public.can_manage_branch(_user, _branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT b.restaurant_id INTO _restaurant FROM public.branches b WHERE b.id = _branch_id;
  IF _restaurant IS NULL THEN RAISE EXCEPTION 'branch not found'; END IF;

  INSERT INTO public.stock_count_sessions(branch_id, business_date, opened_by, notes)
    VALUES (_branch_id, COALESCE(_business_date, CURRENT_DATE), _user, NULLIF(trim(COALESCE(_notes, '')), ''))
  ON CONFLICT (branch_id, business_date)
    DO UPDATE SET notes = COALESCE(NULLIF(trim(COALESCE(_notes, '')), ''), stock_count_sessions.notes)
  RETURNING id INTO _session_id;

  INSERT INTO public.stock_count_lines(session_id, inventory_item_id)
    SELECT _session_id, ii.id
      FROM public.inventory_items ii
      WHERE ii.branch_id = _branch_id
        AND ii.is_active
  ON CONFLICT (session_id, inventory_item_id) DO NOTHING;

  INSERT INTO public.audit_log(restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
    VALUES (
      _restaurant, _branch_id, _user, 'stock_count_session', _session_id, 'opened',
      jsonb_build_object('business_date', COALESCE(_business_date, CURRENT_DATE))
    );

  RETURN _session_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.save_stock_count_lines(
  _session_id uuid,
  _phase text,
  _lines jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _session record;
  _restaurant uuid;
  _line jsonb;
  _item_id uuid;
  _qty numeric(14,3);
  _note text;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _session_id IS NULL THEN RAISE EXCEPTION 'session required'; END IF;
  IF _phase NOT IN ('opening', 'closing') THEN RAISE EXCEPTION 'invalid count phase'; END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' THEN RAISE EXCEPTION 'lines must be an array'; END IF;

  SELECT scs.*
    INTO _session
    FROM public.stock_count_sessions scs
    WHERE scs.id = _session_id
    FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'stock count session not found'; END IF;
  IF NOT public.can_manage_branch(_user, _session.branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _session.status = 'closed' THEN
    RAISE EXCEPTION 'closed sessions cannot be changed';
  END IF;

  SELECT b.restaurant_id INTO _restaurant FROM public.branches b WHERE b.id = _session.branch_id;
  IF _restaurant IS NULL THEN RAISE EXCEPTION 'branch not found'; END IF;

  FOR _line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    _item_id := (_line->>'inventory_item_id')::uuid;
    _qty := NULLIF(_line->>'qty', '')::numeric;
    _note := NULLIF(trim(COALESCE(_line->>'note', '')), '');

    IF _item_id IS NULL THEN RAISE EXCEPTION 'inventory item required'; END IF;
    IF _qty IS NULL OR _qty < 0 THEN RAISE EXCEPTION 'count quantity cannot be negative'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.inventory_items ii WHERE ii.id = _item_id AND ii.branch_id = _session.branch_id
    ) THEN
      RAISE EXCEPTION 'inventory item not in branch';
    END IF;

    INSERT INTO public.stock_count_lines(session_id, inventory_item_id)
      VALUES (_session_id, _item_id)
    ON CONFLICT (session_id, inventory_item_id) DO NOTHING;

    IF _phase = 'opening' THEN
      UPDATE public.stock_count_lines
        SET opening_qty = round(_qty, 3),
            opening_note = _note
        WHERE session_id = _session_id
          AND inventory_item_id = _item_id;
    ELSE
      UPDATE public.stock_count_lines
        SET closing_qty = round(_qty, 3),
            closing_note = _note
        WHERE session_id = _session_id
          AND inventory_item_id = _item_id;
    END IF;
  END LOOP;

  INSERT INTO public.audit_log(restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
    VALUES (
      _restaurant, _session.branch_id, _user, 'stock_count_session', _session_id,
      CASE WHEN _phase = 'opening' THEN 'opening_counts_saved' ELSE 'closing_counts_saved' END,
      jsonb_build_object('business_date', _session.business_date, 'line_count', jsonb_array_length(_lines))
    );
END
$function$;

CREATE OR REPLACE FUNCTION public.close_stock_count_session(
  _session_id uuid,
  _notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _session record;
  _restaurant uuid;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _session_id IS NULL THEN RAISE EXCEPTION 'session required'; END IF;

  SELECT scs.*
    INTO _session
    FROM public.stock_count_sessions scs
    WHERE scs.id = _session_id
    FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'stock count session not found'; END IF;
  IF NOT public.can_manage_branch(_user, _session.branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF EXISTS (
    SELECT 1
      FROM public.stock_count_lines scl
      WHERE scl.session_id = _session_id
        AND scl.opening_qty IS NOT NULL
        AND scl.closing_qty IS NULL
  ) THEN
    RAISE EXCEPTION 'closing count missing for counted opening items';
  END IF;

  SELECT b.restaurant_id INTO _restaurant FROM public.branches b WHERE b.id = _session.branch_id;
  IF _restaurant IS NULL THEN RAISE EXCEPTION 'branch not found'; END IF;

  UPDATE public.stock_count_sessions
    SET status = 'closed',
        closed_by = _user,
        closed_at = now(),
        notes = COALESCE(NULLIF(trim(COALESCE(_notes, '')), ''), notes)
    WHERE id = _session_id;

  INSERT INTO public.audit_log(restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
    VALUES (
      _restaurant, _session.branch_id, _user, 'stock_count_session', _session_id, 'closed',
      jsonb_build_object('business_date', _session.business_date)
    );
END
$function$;

CREATE OR REPLACE FUNCTION public.get_stock_reconciliation_report(
  _session_id uuid
) RETURNS TABLE(
  inventory_item_id uuid,
  item_name text,
  category text,
  unit text,
  opening_qty numeric,
  purchased_qty numeric,
  adjustment_qty numeric,
  waste_qty numeric,
  closing_qty numeric,
  actual_usage_qty numeric,
  theoretical_usage_qty numeric,
  variance_qty numeric,
  variance_cost numeric,
  average_cost numeric,
  status text,
  missing_recipe boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _session record;
  _start_at timestamptz;
  _end_at timestamptz;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT scs.*
    INTO _session
    FROM public.stock_count_sessions scs
    WHERE scs.id = _session_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'stock count session not found'; END IF;
  IF NOT public.can_access_branch(_user, _session.branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  _start_at := (_session.business_date::timestamp AT TIME ZONE 'Asia/Karachi');
  _end_at := ((_session.business_date + 1)::timestamp AT TIME ZONE 'Asia/Karachi');

  RETURN QUERY
  WITH counted AS (
    SELECT
      ii.id,
      ii.name,
      ii.category,
      ii.base_unit,
      ii.average_cost,
      scl.opening_qty,
      scl.closing_qty
    FROM public.stock_count_lines scl
    JOIN public.inventory_items ii ON ii.id = scl.inventory_item_id
    WHERE scl.session_id = _session_id
  ),
  movements AS (
    SELECT
      im.inventory_item_id,
      sum(CASE WHEN im.movement_type = 'purchase' THEN im.quantity_delta ELSE 0 END) AS purchased_qty,
      sum(CASE WHEN im.movement_type IN ('adjustment', 'correction') THEN im.quantity_delta ELSE 0 END) AS adjustment_qty,
      sum(CASE WHEN im.movement_type IN ('waste', 'damage', 'staff_meal') THEN -1 * im.quantity_delta ELSE 0 END) AS waste_qty
    FROM public.inventory_movements im
    WHERE im.branch_id = _session.branch_id
      AND im.created_at >= _start_at
      AND im.created_at < _end_at
    GROUP BY im.inventory_item_id
  ),
  theoretical AS (
    SELECT
      ir.inventory_item_id,
      sum(ir.quantity * oi.qty) AS theoretical_usage_qty
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.inventory_recipes ir ON ir.menu_item_id = oi.item_id
    WHERE o.branch_id = _session.branch_id
      AND o.created_at >= _start_at
      AND o.created_at < _end_at
      AND o.status NOT IN ('cancelled', 'voided', 'refunded')
    GROUP BY ir.inventory_item_id
  ),
  missing AS (
    SELECT DISTINCT oi.item_id
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.branch_id = _session.branch_id
      AND o.created_at >= _start_at
      AND o.created_at < _end_at
      AND o.status NOT IN ('cancelled', 'voided', 'refunded')
      AND oi.item_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.inventory_recipes ir WHERE ir.menu_item_id = oi.item_id
      )
  )
  SELECT
    c.id,
    c.name,
    c.category,
    c.base_unit::text,
    c.opening_qty,
    round(COALESCE(m.purchased_qty, 0), 3)::numeric,
    round(COALESCE(m.adjustment_qty, 0), 3)::numeric,
    round(COALESCE(m.waste_qty, 0), 3)::numeric,
    c.closing_qty,
    CASE
      WHEN c.opening_qty IS NULL OR c.closing_qty IS NULL THEN NULL
      ELSE round(c.opening_qty + COALESCE(m.purchased_qty, 0) - COALESCE(m.waste_qty, 0) - c.closing_qty, 3)
    END::numeric AS actual_usage_qty,
    round(COALESCE(t.theoretical_usage_qty, 0), 3)::numeric AS theoretical_usage_qty,
    CASE
      WHEN c.opening_qty IS NULL OR c.closing_qty IS NULL THEN NULL
      ELSE round(c.opening_qty + COALESCE(m.purchased_qty, 0) - COALESCE(m.waste_qty, 0) - c.closing_qty - COALESCE(t.theoretical_usage_qty, 0), 3)
    END::numeric AS variance_qty,
    CASE
      WHEN c.opening_qty IS NULL OR c.closing_qty IS NULL THEN NULL
      ELSE round((c.opening_qty + COALESCE(m.purchased_qty, 0) - COALESCE(m.waste_qty, 0) - c.closing_qty - COALESCE(t.theoretical_usage_qty, 0)) * c.average_cost, 2)
    END::numeric AS variance_cost,
    c.average_cost,
    CASE
      WHEN c.opening_qty IS NULL THEN 'needs_opening'
      WHEN c.closing_qty IS NULL THEN 'needs_closing'
      WHEN abs(c.opening_qty + COALESCE(m.purchased_qty, 0) - COALESCE(m.waste_qty, 0) - c.closing_qty - COALESCE(t.theoretical_usage_qty, 0)) <= 0.001 THEN 'balanced'
      WHEN c.opening_qty + COALESCE(m.purchased_qty, 0) - COALESCE(m.waste_qty, 0) - c.closing_qty - COALESCE(t.theoretical_usage_qty, 0) > 0 THEN 'over_used'
      ELSE 'under_used'
    END::text AS status,
    EXISTS (SELECT 1 FROM missing)::boolean AS missing_recipe
  FROM counted c
  LEFT JOIN movements m ON m.inventory_item_id = c.id
  LEFT JOIN theoretical t ON t.inventory_item_id = c.id
  ORDER BY
    CASE
      WHEN c.opening_qty IS NULL OR c.closing_qty IS NULL THEN 999999999
      ELSE abs(c.opening_qty + COALESCE(m.purchased_qty, 0) - COALESCE(m.waste_qty, 0) - c.closing_qty - COALESCE(t.theoretical_usage_qty, 0)) * c.average_cost
    END DESC,
    c.name;
END
$function$;

CREATE OR REPLACE FUNCTION public.get_stock_count_session(
  _branch_id uuid,
  _business_date date
) RETURNS TABLE(
  id uuid,
  business_date date,
  status text,
  notes text,
  opened_at timestamptz,
  closed_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _branch_id IS NULL THEN RAISE EXCEPTION 'branch required'; END IF;
  IF _business_date IS NULL THEN RAISE EXCEPTION 'business date required'; END IF;
  IF NOT public.can_access_branch(_user, _branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  SELECT
    scs.id,
    scs.business_date,
    scs.status::text,
    scs.notes,
    scs.opened_at,
    scs.closed_at
  FROM public.stock_count_sessions scs
  WHERE scs.branch_id = _branch_id
    AND scs.business_date = _business_date;
END
$function$;

CREATE OR REPLACE FUNCTION public.get_stock_count_lines(
  _session_id uuid
) RETURNS TABLE(
  inventory_item_id uuid,
  opening_qty numeric,
  closing_qty numeric,
  opening_note text,
  closing_note text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _session record;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _session_id IS NULL THEN RAISE EXCEPTION 'session required'; END IF;

  SELECT scs.*
    INTO _session
    FROM public.stock_count_sessions scs
    WHERE scs.id = _session_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'stock count session not found'; END IF;
  IF NOT public.can_access_branch(_user, _session.branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  SELECT
    scl.inventory_item_id,
    scl.opening_qty,
    scl.closing_qty,
    scl.opening_note,
    scl.closing_note
  FROM public.stock_count_lines scl
  WHERE scl.session_id = _session_id
  ORDER BY scl.created_at, scl.inventory_item_id;
END
$function$;

GRANT EXECUTE ON FUNCTION public.open_stock_count_session(uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_stock_count_lines(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_stock_count_session(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_reconciliation_report(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_count_session(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_count_lines(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.open_stock_count_session(uuid, date, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_stock_count_lines(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.close_stock_count_session(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_stock_reconciliation_report(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_stock_count_session(uuid, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_stock_count_lines(uuid) FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';
