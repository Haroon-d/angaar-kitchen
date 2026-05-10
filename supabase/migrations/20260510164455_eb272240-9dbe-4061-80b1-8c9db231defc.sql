
-- =========================================================
-- ENUMS
-- =========================================================
create type public.app_role as enum ('owner','admin','manager','cashier','kitchen','waiter');
create type public.dining_type as enum ('dine_in','takeaway','delivery');
create type public.order_status as enum ('open','placed','preparing','ready','served','completed','cancelled');
create type public.payment_method as enum ('cash','card','upi','wallet','other');

-- =========================================================
-- PROFILES
-- =========================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.handle_updated_at();

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- =========================================================
-- RESTAURANTS / BRANCHES
-- =========================================================
create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  name text not null,
  legal_name text,
  logo_url text,
  currency text not null default 'INR',
  currency_symbol text not null default '₹',
  timezone text not null default 'Asia/Kolkata',
  phone text,
  email text,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.restaurants enable row level security;
create trigger restaurants_updated_at before update on public.restaurants
for each row execute function public.handle_updated_at();

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  code text not null,
  name text not null,
  address text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(restaurant_id, code)
);
alter table public.branches enable row level security;
create trigger branches_updated_at before update on public.branches
for each row execute function public.handle_updated_at();

-- =========================================================
-- USER ROLES
-- =========================================================
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique(user_id, restaurant_id, branch_id, role)
);
alter table public.user_roles enable row level security;

-- Security definer helpers (avoid RLS recursion)
create or replace function public.has_role_in_restaurant(_user uuid, _restaurant uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user and restaurant_id = _restaurant and role = _role
  );
$$;

create or replace function public.is_restaurant_member(_user uuid, _restaurant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles where user_id = _user and restaurant_id = _restaurant
  );
$$;

create or replace function public.is_restaurant_admin(_user uuid, _restaurant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user and restaurant_id = _restaurant
      and role in ('owner','admin')
  );
$$;

create or replace function public.can_access_branch(_user uuid, _branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.branches b
    join public.user_roles ur on ur.restaurant_id = b.restaurant_id
    where b.id = _branch
      and ur.user_id = _user
      and (ur.role in ('owner','admin') or ur.branch_id is null or ur.branch_id = b.id)
  );
$$;

create or replace function public.can_manage_branch(_user uuid, _branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.branches b
    join public.user_roles ur on ur.restaurant_id = b.restaurant_id
    where b.id = _branch
      and ur.user_id = _user
      and (
        ur.role in ('owner','admin')
        or (ur.role = 'manager' and (ur.branch_id is null or ur.branch_id = b.id))
      )
  );
$$;

-- Get the current user's primary restaurant (first one they belong to)
create or replace function public.current_user_restaurant()
returns uuid language sql stable security definer set search_path = public as $$
  select restaurant_id from public.user_roles
  where user_id = auth.uid()
  order by created_at asc
  limit 1;
$$;

-- =========================================================
-- TAXES & OPERATING HOURS
-- =========================================================
create table public.taxes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  rate numeric(6,3) not null check (rate >= 0 and rate <= 100),
  is_inclusive boolean not null default false,
  is_active boolean not null default true,
  apply_by_default boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.taxes enable row level security;

create table public.operating_hours (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  open_time time,
  close_time time,
  is_closed boolean not null default false,
  unique(branch_id, weekday)
);
alter table public.operating_hours enable row level security;

-- =========================================================
-- MENU
-- =========================================================
create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  description text,
  image_url text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.menu_categories enable row level security;
create trigger menu_categories_updated_at before update on public.menu_categories
for each row execute function public.handle_updated_at();

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.menu_categories(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  description text,
  base_price numeric(12,2) not null check (base_price >= 0),
  image_url text,
  is_available boolean not null default true,
  is_veg boolean,
  prep_time_min int default 15,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.menu_items enable row level security;
create trigger menu_items_updated_at before update on public.menu_items
for each row execute function public.handle_updated_at();
create index on public.menu_items(branch_id);
create index on public.menu_items(category_id);

create table public.item_variants (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.menu_items(id) on delete cascade,
  name text not null,
  price_delta numeric(12,2) not null default 0,
  is_default boolean not null default false,
  sort_order int not null default 0
);
alter table public.item_variants enable row level security;

create table public.addon_groups (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  min_select int not null default 0,
  max_select int not null default 1,
  is_required boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.addon_groups enable row level security;

create table public.addons (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.addon_groups(id) on delete cascade,
  name text not null,
  price numeric(12,2) not null default 0,
  is_active boolean not null default true
);
alter table public.addons enable row level security;

create table public.item_addon_groups (
  item_id uuid not null references public.menu_items(id) on delete cascade,
  group_id uuid not null references public.addon_groups(id) on delete cascade,
  primary key(item_id, group_id)
);
alter table public.item_addon_groups enable row level security;

-- =========================================================
-- ORDERS
-- =========================================================
create table public.order_counters (
  branch_id uuid not null references public.branches(id) on delete cascade,
  counter_date date not null,
  last_seq int not null default 0,
  primary key(branch_id, counter_date)
);
alter table public.order_counters enable row level security;

create or replace function public.next_order_number(_branch uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  _today date := (now() at time zone 'UTC')::date;
  _seq int;
  _code text;
begin
  insert into public.order_counters(branch_id, counter_date, last_seq)
  values (_branch, _today, 1)
  on conflict (branch_id, counter_date)
  do update set last_seq = order_counters.last_seq + 1
  returning last_seq into _seq;

  select code into _code from public.branches where id = _branch;
  return 'AK-' || coalesce(_code,'BR') || '-' || to_char(_today,'YYYYMMDD') || '-' || lpad(_seq::text, 4, '0');
end $$;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  order_no text not null unique,
  dining_type dining_type not null default 'dine_in',
  status order_status not null default 'open',
  customer_name text,
  customer_phone text,
  table_label text,
  notes text,
  subtotal numeric(12,2) not null default 0,
  discount_total numeric(12,2) not null default 0,
  tax_total numeric(12,2) not null default 0,
  grand_total numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.orders enable row level security;
create trigger orders_updated_at before update on public.orders
for each row execute function public.handle_updated_at();
create index on public.orders(branch_id, created_at desc);
create index on public.orders(status);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  item_id uuid references public.menu_items(id) on delete set null,
  variant_id uuid references public.item_variants(id) on delete set null,
  name_snapshot text not null,
  variant_snapshot text,
  unit_price numeric(12,2) not null,
  qty int not null check (qty > 0),
  addons_total numeric(12,2) not null default 0,
  line_subtotal numeric(12,2) not null,
  notes text
);
alter table public.order_items enable row level security;
create index on public.order_items(order_id);

create table public.order_item_addons (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  addon_id uuid references public.addons(id) on delete set null,
  name_snapshot text not null,
  price_snapshot numeric(12,2) not null
);
alter table public.order_item_addons enable row level security;

create table public.order_taxes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  tax_id uuid references public.taxes(id) on delete set null,
  name_snapshot text not null,
  rate_snapshot numeric(6,3) not null,
  amount numeric(12,2) not null
);
alter table public.order_taxes enable row level security;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  method payment_method not null,
  amount numeric(12,2) not null check (amount > 0),
  reference text,
  paid_at timestamptz not null default now(),
  received_by uuid references auth.users(id) on delete set null
);
alter table public.payments enable row level security;

-- =========================================================
-- RLS POLICIES
-- =========================================================

-- profiles
create policy "profiles_self_select" on public.profiles for select using (auth.uid() = id);
create policy "profiles_self_update" on public.profiles for update using (auth.uid() = id);
create policy "profiles_self_insert" on public.profiles for insert with check (auth.uid() = id);

-- restaurants
create policy "restaurants_member_select" on public.restaurants for select
  using (public.is_restaurant_member(auth.uid(), id));
create policy "restaurants_owner_insert" on public.restaurants for insert
  with check (auth.uid() = owner_id);
create policy "restaurants_admin_update" on public.restaurants for update
  using (public.is_restaurant_admin(auth.uid(), id));
create policy "restaurants_owner_delete" on public.restaurants for delete
  using (auth.uid() = owner_id);

-- branches
create policy "branches_member_select" on public.branches for select
  using (public.is_restaurant_member(auth.uid(), restaurant_id));
create policy "branches_admin_all" on public.branches for all
  using (public.is_restaurant_admin(auth.uid(), restaurant_id))
  with check (public.is_restaurant_admin(auth.uid(), restaurant_id));

-- user_roles
create policy "roles_self_select" on public.user_roles for select
  using (user_id = auth.uid() or public.is_restaurant_admin(auth.uid(), restaurant_id));
create policy "roles_admin_manage" on public.user_roles for all
  using (public.is_restaurant_admin(auth.uid(), restaurant_id))
  with check (public.is_restaurant_admin(auth.uid(), restaurant_id));
-- Allow a brand-new restaurant owner to insert their own owner role during onboarding
create policy "roles_owner_bootstrap" on public.user_roles for insert
  with check (
    user_id = auth.uid() and role = 'owner'
    and exists (select 1 from public.restaurants r where r.id = restaurant_id and r.owner_id = auth.uid())
  );

-- taxes
create policy "taxes_member_select" on public.taxes for select
  using (public.is_restaurant_member(auth.uid(), restaurant_id));
create policy "taxes_admin_all" on public.taxes for all
  using (public.is_restaurant_admin(auth.uid(), restaurant_id))
  with check (public.is_restaurant_admin(auth.uid(), restaurant_id));

-- operating_hours
create policy "oh_member_select" on public.operating_hours for select
  using (public.can_access_branch(auth.uid(), branch_id));
create policy "oh_manager_all" on public.operating_hours for all
  using (public.can_manage_branch(auth.uid(), branch_id))
  with check (public.can_manage_branch(auth.uid(), branch_id));

-- menu_categories
create policy "mc_member_select" on public.menu_categories for select
  using (public.can_access_branch(auth.uid(), branch_id));
create policy "mc_manager_all" on public.menu_categories for all
  using (public.can_manage_branch(auth.uid(), branch_id))
  with check (public.can_manage_branch(auth.uid(), branch_id));

-- menu_items
create policy "mi_member_select" on public.menu_items for select
  using (public.can_access_branch(auth.uid(), branch_id));
create policy "mi_manager_all" on public.menu_items for all
  using (public.can_manage_branch(auth.uid(), branch_id))
  with check (public.can_manage_branch(auth.uid(), branch_id));

-- item_variants (via parent item)
create policy "iv_member_select" on public.item_variants for select
  using (exists (select 1 from public.menu_items mi where mi.id = item_id and public.can_access_branch(auth.uid(), mi.branch_id)));
create policy "iv_manager_all" on public.item_variants for all
  using (exists (select 1 from public.menu_items mi where mi.id = item_id and public.can_manage_branch(auth.uid(), mi.branch_id)))
  with check (exists (select 1 from public.menu_items mi where mi.id = item_id and public.can_manage_branch(auth.uid(), mi.branch_id)));

-- addon_groups
create policy "ag_member_select" on public.addon_groups for select
  using (public.can_access_branch(auth.uid(), branch_id));
create policy "ag_manager_all" on public.addon_groups for all
  using (public.can_manage_branch(auth.uid(), branch_id))
  with check (public.can_manage_branch(auth.uid(), branch_id));

-- addons
create policy "ad_member_select" on public.addons for select
  using (exists (select 1 from public.addon_groups g where g.id = group_id and public.can_access_branch(auth.uid(), g.branch_id)));
create policy "ad_manager_all" on public.addons for all
  using (exists (select 1 from public.addon_groups g where g.id = group_id and public.can_manage_branch(auth.uid(), g.branch_id)))
  with check (exists (select 1 from public.addon_groups g where g.id = group_id and public.can_manage_branch(auth.uid(), g.branch_id)));

-- item_addon_groups
create policy "iag_member_select" on public.item_addon_groups for select
  using (exists (select 1 from public.menu_items mi where mi.id = item_id and public.can_access_branch(auth.uid(), mi.branch_id)));
create policy "iag_manager_all" on public.item_addon_groups for all
  using (exists (select 1 from public.menu_items mi where mi.id = item_id and public.can_manage_branch(auth.uid(), mi.branch_id)))
  with check (exists (select 1 from public.menu_items mi where mi.id = item_id and public.can_manage_branch(auth.uid(), mi.branch_id)));

-- order_counters
create policy "oc_member_select" on public.order_counters for select
  using (public.can_access_branch(auth.uid(), branch_id));

-- orders
create policy "orders_member_select" on public.orders for select
  using (public.can_access_branch(auth.uid(), branch_id));
create policy "orders_member_insert" on public.orders for insert
  with check (public.can_access_branch(auth.uid(), branch_id));
create policy "orders_member_update" on public.orders for update
  using (public.can_access_branch(auth.uid(), branch_id));

-- order_items / addons / taxes / payments via parent order
create policy "oi_select" on public.order_items for select
  using (exists (select 1 from public.orders o where o.id = order_id and public.can_access_branch(auth.uid(), o.branch_id)));
create policy "oi_all" on public.order_items for all
  using (exists (select 1 from public.orders o where o.id = order_id and public.can_access_branch(auth.uid(), o.branch_id)))
  with check (exists (select 1 from public.orders o where o.id = order_id and public.can_access_branch(auth.uid(), o.branch_id)));

create policy "oia_select" on public.order_item_addons for select
  using (exists (
    select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
    where oi.id = order_item_id and public.can_access_branch(auth.uid(), o.branch_id)));
create policy "oia_all" on public.order_item_addons for all
  using (exists (
    select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
    where oi.id = order_item_id and public.can_access_branch(auth.uid(), o.branch_id)))
  with check (exists (
    select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
    where oi.id = order_item_id and public.can_access_branch(auth.uid(), o.branch_id)));

create policy "ot_select" on public.order_taxes for select
  using (exists (select 1 from public.orders o where o.id = order_id and public.can_access_branch(auth.uid(), o.branch_id)));
create policy "ot_all" on public.order_taxes for all
  using (exists (select 1 from public.orders o where o.id = order_id and public.can_access_branch(auth.uid(), o.branch_id)))
  with check (exists (select 1 from public.orders o where o.id = order_id and public.can_access_branch(auth.uid(), o.branch_id)));

create policy "pay_select" on public.payments for select
  using (exists (select 1 from public.orders o where o.id = order_id and public.can_access_branch(auth.uid(), o.branch_id)));
create policy "pay_all" on public.payments for all
  using (exists (select 1 from public.orders o where o.id = order_id and public.can_access_branch(auth.uid(), o.branch_id)))
  with check (exists (select 1 from public.orders o where o.id = order_id and public.can_access_branch(auth.uid(), o.branch_id)));

-- =========================================================
-- STORAGE
-- =========================================================
insert into storage.buckets (id, name, public)
values ('menu-images','menu-images', true)
on conflict (id) do nothing;

create policy "menu_images_public_read" on storage.objects for select
  using (bucket_id = 'menu-images');
create policy "menu_images_authed_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'menu-images');
create policy "menu_images_authed_update" on storage.objects for update to authenticated
  using (bucket_id = 'menu-images');
create policy "menu_images_authed_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'menu-images');
