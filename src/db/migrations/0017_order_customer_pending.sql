alter table orders
  add column if not exists is_customer_pending boolean not null default false;

create index if not exists orders_customer_pending_idx
  on orders(branch_id, is_customer_pending, payment_status, created_at);
