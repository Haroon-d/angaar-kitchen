create table if not exists public.branch_printer_settings (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.branch_printer_settings enable row level security;

drop policy if exists "bps_member_select" on public.branch_printer_settings;
create policy "bps_member_select"
  on public.branch_printer_settings
  for select
  using (public.can_access_branch(auth.uid(), branch_id));

drop policy if exists "bps_manager_all" on public.branch_printer_settings;
create policy "bps_manager_all"
  on public.branch_printer_settings
  for all
  using (public.can_manage_branch(auth.uid(), branch_id))
  with check (public.can_manage_branch(auth.uid(), branch_id));

create index if not exists bps_updated_at_idx on public.branch_printer_settings(updated_at desc);
