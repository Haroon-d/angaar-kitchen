alter table branches
  add column if not exists finance_cutover_at timestamp with time zone;
