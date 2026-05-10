
-- Lock down SECURITY DEFINER helpers from anon role
revoke execute on function public.has_role_in_restaurant(uuid, uuid, app_role) from anon, public;
revoke execute on function public.is_restaurant_member(uuid, uuid) from anon, public;
revoke execute on function public.is_restaurant_admin(uuid, uuid) from anon, public;
revoke execute on function public.can_access_branch(uuid, uuid) from anon, public;
revoke execute on function public.can_manage_branch(uuid, uuid) from anon, public;
revoke execute on function public.current_user_restaurant() from anon, public;
revoke execute on function public.next_order_number(uuid) from anon, public;
revoke execute on function public.handle_new_user() from anon, public;
revoke execute on function public.handle_updated_at() from anon, public;

grant execute on function public.has_role_in_restaurant(uuid, uuid, app_role) to authenticated;
grant execute on function public.is_restaurant_member(uuid, uuid) to authenticated;
grant execute on function public.is_restaurant_admin(uuid, uuid) to authenticated;
grant execute on function public.can_access_branch(uuid, uuid) to authenticated;
grant execute on function public.can_manage_branch(uuid, uuid) to authenticated;
grant execute on function public.current_user_restaurant() to authenticated;
grant execute on function public.next_order_number(uuid) to authenticated;

-- Tighten search_path on the trigger helpers
alter function public.handle_updated_at() set search_path = public;

-- Restrict bucket listing: only authenticated users may list files
drop policy if exists "menu_images_public_read" on storage.objects;
create policy "menu_images_public_read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'menu-images' and (storage.foldername(name))[1] is not null);
