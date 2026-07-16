do $$ begin
  create type finance_account_type as enum ('counter_cash', 'online', 'bank', 'wallet', 'other');
exception
  when duplicate_object then null;
end $$;

alter table branches
  add column if not exists business_day_start_time time not null default '10:00:00';

create table if not exists finance_accounts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  branch_id uuid references branches(id) on delete cascade,
  name text not null,
  account_type finance_account_type not null default 'other',
  is_cash boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists finance_accounts_branch_name_unique
  on finance_accounts(branch_id, name);

create index if not exists finance_accounts_branch_active_idx
  on finance_accounts(branch_id, is_active, sort_order);

insert into finance_accounts (restaurant_id, branch_id, name, account_type, is_cash, sort_order)
select b.restaurant_id, b.id, 'Counter Cash', 'counter_cash', true, 10
from branches b
on conflict (branch_id, name) do nothing;

insert into finance_accounts (restaurant_id, branch_id, name, account_type, is_cash, sort_order)
select b.restaurant_id, b.id, 'Online', 'online', false, 20
from branches b
on conflict (branch_id, name) do nothing;

insert into finance_accounts (restaurant_id, branch_id, name, account_type, is_cash, sort_order)
select b.restaurant_id, b.id, 'Other', 'other', false, 30
from branches b
on conflict (branch_id, name) do nothing;

alter table payments
  add column if not exists finance_account_id uuid references finance_accounts(id) on delete set null;

create index if not exists payments_finance_account_idx
  on payments(finance_account_id);

alter table operational_expenses
  add column if not exists finance_account_id uuid references finance_accounts(id) on delete set null;

create index if not exists operational_expenses_finance_account_idx
  on operational_expenses(finance_account_id);
