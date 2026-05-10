revoke execute on function public.is_restaurant_admin(uuid, uuid) from anon, public;
revoke execute on function public.is_restaurant_member(uuid, uuid) from anon, public;
revoke execute on function public.has_role_in_restaurant(uuid, uuid, app_role) from anon, public;
revoke execute on function public.can_access_branch(uuid, uuid) from anon, public;
revoke execute on function public.can_manage_branch(uuid, uuid) from anon, public;
revoke execute on function public.current_user_restaurant() from anon, public;
revoke execute on function public.next_order_number(uuid) from anon, public;
revoke execute on function public.handle_new_user() from anon, authenticated, public;
revoke execute on function public.handle_updated_at() from anon, authenticated, public;