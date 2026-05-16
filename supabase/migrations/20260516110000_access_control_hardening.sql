-- Access-control hardening for public/customer accounts vs operational users.
-- Operational access is granted only by owner/admin-created user_roles rows.

DROP POLICY IF EXISTS roles_owner_bootstrap ON public.user_roles;

-- Be explicit that customers and anonymous visitors can read active menu data only.
-- Mutations remain controlled by existing manager policies and server-side order code.
DROP POLICY IF EXISTS branches_public_active_select ON public.branches;
DROP POLICY IF EXISTS menu_categories_public_active_select ON public.menu_categories;
DROP POLICY IF EXISTS menu_items_public_available_select ON public.menu_items;

CREATE POLICY branches_public_active_select ON public.branches
  FOR SELECT TO anon, authenticated
  USING (is_active = true);

CREATE POLICY menu_categories_public_active_select ON public.menu_categories
  FOR SELECT TO anon, authenticated
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1
      FROM public.branches b
      WHERE b.id = branch_id
        AND b.is_active = true
    )
  );

CREATE POLICY menu_items_public_available_select ON public.menu_items
  FOR SELECT TO anon, authenticated
  USING (
    is_available = true
    AND EXISTS (
      SELECT 1
      FROM public.branches b
      WHERE b.id = branch_id
        AND b.is_active = true
    )
  );

NOTIFY pgrst, 'reload schema';
