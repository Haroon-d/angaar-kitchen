
-- 1) Storage: scope menu-images writes to managers of the branch.
-- File path convention: <branch_id>/<filename>
DROP POLICY IF EXISTS menu_images_authed_write  ON storage.objects;
DROP POLICY IF EXISTS menu_images_authed_update ON storage.objects;
DROP POLICY IF EXISTS menu_images_authed_delete ON storage.objects;

CREATE POLICY menu_images_manager_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'menu-images'
    AND public.can_manage_branch(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY menu_images_manager_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'menu-images'
    AND public.can_manage_branch(auth.uid(), ((storage.foldername(name))[1])::uuid)
  )
  WITH CHECK (
    bucket_id = 'menu-images'
    AND public.can_manage_branch(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY menu_images_manager_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'menu-images'
    AND public.can_manage_branch(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

-- 2) Orders: prevent direct mutation of financial fields by branch members.
-- Restrict UPDATE/INSERT to managers; cashiers/waiters must go through SECURITY DEFINER RPCs
-- (create_pos_order, record_payment, record_print) which run as definer and bypass RLS.
DROP POLICY IF EXISTS orders_member_update ON public.orders;
DROP POLICY IF EXISTS orders_member_insert ON public.orders;

CREATE POLICY orders_manager_update ON public.orders
  FOR UPDATE TO authenticated
  USING (public.can_manage_branch(auth.uid(), branch_id))
  WITH CHECK (public.can_manage_branch(auth.uid(), branch_id));

CREATE POLICY orders_manager_insert ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_branch(auth.uid(), branch_id));

-- 3) SECURITY DEFINER functions: revoke EXECUTE from anon and PUBLIC.
REVOKE EXECUTE ON FUNCTION public.create_pos_order(uuid, dining_type, text, text, text, numeric, jsonb, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_payment(uuid, payment_method, numeric, text)                       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_print(uuid, text)                                                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.next_order_number(uuid)                                                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_restaurant_member(uuid, uuid)                                          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_restaurant_admin(uuid, uuid)                                           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role_in_restaurant(uuid, uuid, app_role)                              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_access_branch(uuid, uuid)                                             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_branch(uuid, uuid)                                             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_restaurant()                                                 FROM PUBLIC, anon;
