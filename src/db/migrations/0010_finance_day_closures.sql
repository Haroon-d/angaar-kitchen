create table if not exists finance_day_closures (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id) on delete cascade,
  business_date date not null,
  opening_cash numeric(14, 2) not null default 0,
  opening_online numeric(14, 2) not null default 0,
  expected_cash numeric(14, 2) not null default 0,
  expected_online numeric(14, 2) not null default 0,
  actual_cash numeric(14, 2),
  actual_online numeric(14, 2),
  cash_difference numeric(14, 2) not null default 0,
  online_difference numeric(14, 2) not null default 0,
  notes text,
  closed_by uuid references users(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists finance_day_closures_branch_date_unique
  on finance_day_closures(branch_id, business_date);

create index if not exists finance_day_closures_branch_date_idx
  on finance_day_closures(branch_id, business_date);
