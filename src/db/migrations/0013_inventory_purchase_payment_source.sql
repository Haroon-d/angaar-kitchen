alter table inventory_purchases
  add column if not exists finance_account_id uuid references finance_accounts(id) on delete set null;

create index if not exists inventory_purchases_finance_account_idx
  on inventory_purchases(finance_account_id);
