alter table finance_accounts
  add column if not exists is_reserve boolean not null default false;

create unique index if not exists finance_accounts_one_reserve_per_branch
  on finance_accounts(branch_id)
  where is_reserve = true;

insert into finance_accounts (
  restaurant_id,
  branch_id,
  name,
  account_type,
  is_cash,
  is_reserve,
  sort_order
)
select
  b.restaurant_id,
  b.id,
  case
    when exists (
      select 1 from finance_accounts existing
      where existing.branch_id = b.id and existing.name = 'Profit Reserve'
    ) then 'Profit Reserve (' || left(b.id::text, 8) || ')'
    else 'Profit Reserve'
  end,
  'other',
  false,
  true,
  5
from branches b
where not exists (
  select 1 from finance_accounts existing
  where existing.branch_id = b.id and existing.is_reserve = true
)
on conflict do nothing;