alter table supplier_ledger_entries
  add column if not exists finance_account_id uuid references finance_accounts(id) on delete set null;

create index if not exists supplier_ledger_finance_account_idx
  on supplier_ledger_entries(finance_account_id);
