-- Stock count session corrections.
-- Closed daily counts are used for recipe learning, so corrections must be
-- explicit, reasoned, and audited.

CREATE OR REPLACE FUNCTION public.reopen_stock_count_session(
  _session_id uuid,
  _reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _session record;
  _restaurant uuid;
  _reason_clean text := NULLIF(trim(COALESCE(_reason, '')), '');
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _session_id IS NULL THEN RAISE EXCEPTION 'session required'; END IF;
  IF _reason_clean IS NULL THEN RAISE EXCEPTION 'reopen reason required'; END IF;

  SELECT scs.*
    INTO _session
    FROM public.stock_count_sessions scs
    WHERE scs.id = _session_id
    FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'stock count session not found'; END IF;
  IF NOT public.can_manage_branch(_user, _session.branch_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _session.status <> 'closed' THEN RAISE EXCEPTION 'only closed sessions can be reopened'; END IF;

  SELECT b.restaurant_id INTO _restaurant
    FROM public.branches b
    WHERE b.id = _session.branch_id;
  IF _restaurant IS NULL THEN RAISE EXCEPTION 'branch not found'; END IF;

  UPDATE public.stock_count_sessions
    SET status = 'open',
        closed_by = NULL,
        closed_at = NULL
    WHERE id = _session_id;

  INSERT INTO public.audit_log(restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
    VALUES (
      _restaurant, _session.branch_id, _user, 'stock_count_session', _session_id, 'reopened',
      jsonb_build_object(
        'business_date', _session.business_date,
        'old_status', _session.status,
        'old_closed_at', _session.closed_at,
        'reason', _reason_clean
      )
    );
END
$function$;

CREATE OR REPLACE FUNCTION public.delete_stock_count_session_admin(
  _session_id uuid,
  _reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _session record;
  _reason_clean text := NULLIF(trim(COALESCE(_reason, '')), '');
  _line_count integer;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _session_id IS NULL THEN RAISE EXCEPTION 'session required'; END IF;
  IF _reason_clean IS NULL THEN RAISE EXCEPTION 'delete reason required'; END IF;

  SELECT scs.*, b.restaurant_id
    INTO _session
    FROM public.stock_count_sessions scs
    JOIN public.branches b ON b.id = scs.branch_id
    WHERE scs.id = _session_id
    FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'stock count session not found'; END IF;
  IF NOT public.is_restaurant_admin(_user, _session.restaurant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT count(*)::integer INTO _line_count
    FROM public.stock_count_lines scl
    WHERE scl.session_id = _session_id;

  INSERT INTO public.audit_log(restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
    VALUES (
      _session.restaurant_id, _session.branch_id, _user, 'stock_count_session', _session_id, 'deleted',
      jsonb_build_object(
        'business_date', _session.business_date,
        'status', _session.status,
        'opened_at', _session.opened_at,
        'closed_at', _session.closed_at,
        'line_count', _line_count,
        'reason', _reason_clean
      )
    );

  DELETE FROM public.stock_count_sessions scs
    WHERE scs.id = _session_id;
END
$function$;

GRANT EXECUTE ON FUNCTION public.reopen_stock_count_session(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_stock_count_session_admin(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.reopen_stock_count_session(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_stock_count_session_admin(uuid, text) FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';
