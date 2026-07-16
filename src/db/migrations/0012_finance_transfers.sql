create table if not exists finance_transfers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  title text not null,
  transfer_type text not null default 'internal_transfer'
    check (transfer_type in ('internal_transfer', 'owner_contribution', 'owner_withdrawal', 'cash_deposit', 'cash_withdrawal', 'correction')),
  from_account_id uuid references finance_accounts(id) on delete restrict,
  to_account_id uuid references finance_accounts(id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  reference text,
  notes text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_account_id is not null or to_account_id is not null),
  check (from_account_id is distinct from to_account_id)
);

create index if not exists finance_transfers_branch_occurred_idx
  on finance_transfers(branch_id, occurred_at desc);

create index if not exists finance_transfers_from_account_idx
  on finance_transfers(from_account_id);

create index if not exists finance_transfers_to_account_idx
  on finance_transfers(to_account_id);
