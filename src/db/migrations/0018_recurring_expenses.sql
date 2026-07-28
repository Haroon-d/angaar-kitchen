create table if not exists recurring_operational_expenses (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id) on delete cascade,
  category_id uuid references operational_expense_categories(id) on delete set null,
  title text not null,
  vendor text,
  amount numeric(14,2) not null,
  frequency text not null default 'daily',
  start_date date not null default current_date,
  end_date date,
  day_of_week integer,
  day_of_month integer,
  is_active boolean not null default true,
  last_generated_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_operational_expenses_title_not_blank check (length(trim(title)) > 0),
  constraint recurring_operational_expenses_amount_nonnegative check (amount >= 0),
  constraint recurring_operational_expenses_frequency_check check (frequency in ('daily', 'weekly', 'monthly'))
);

alter table operational_expenses
  add column if not exists recurring_expense_id uuid references recurring_operational_expenses(id) on delete set null,
  add column if not exists recurring_for_date date;

create unique index if not exists operational_expenses_recurring_unique
  on operational_expenses(branch_id, recurring_expense_id, recurring_for_date);

create index if not exists recurring_operational_expenses_branch_active_idx
  on recurring_operational_expenses(branch_id, is_active, start_date);

create index if not exists operational_expenses_recurring_idx
  on operational_expenses(recurring_expense_id, recurring_for_date);
