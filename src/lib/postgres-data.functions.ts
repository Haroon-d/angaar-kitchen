import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pgPool } from "@/db/client.server";
import { requirePostgresAuth } from "@/integrations/postgres/auth-middleware";
import { AuthorizationError, getUserRoles } from "@/services/authorization.service.server";
import { recalculateCustomerStats } from "@/services/customer-stats.service.server";
import { recordCouponRedemption, validateCoupon } from "@/services/coupon.service.server";
import { hasAnyPermission, type AppPermission } from "@/lib/rbac";
import { unitFactorToBase, type InventoryBaseUnit } from "@/lib/inventory-units";

const TABLES = new Set([
  "restaurants",
  "branches",
  "operating_hours",
  "taxes",
  "menu_categories",
  "menu_items",
  "orders",
  "order_items",
  "order_taxes",
  "payments",
  "finance_accounts",
  "finance_day_closures",
  "finance_transfers",
  "finance_movements",
  "finance_account_positions",
  "finance_obligations",
  "customers",
  "customer_addresses",
  "customer_events",
  "coupon_campaigns",
  "coupon_redemptions",
  "homepage_promotions",
  "job_posts",
  "job_applications",
  "customer_reviews",
  "product_analytics_events",
  "profiles",
  "user_roles",
  "inventory_items",
  "inventory_movements",
  "inventory_purchases",
  "inventory_purchase_lines",
  "inventory_unit_conversions",
  "inventory_recipes",
  "inventory_cost_layers",
  "inventory_fifo_consumptions",
  "inventory_counts",
  "inventory_count_lines",
  "supplier_ledger_entries",
  "suppliers",
  "operational_expenses",
  "operational_expense_categories",
  "recurring_operational_expenses",
  "branch_printer_settings",
  "inventory_low_stock",
  "inventory_food_cost_by_menu_item",
  "inventory_menu_performance",
]);

type DataOperation = "read" | "write" | "delete";

type DataPolicy = {
  read: readonly AppPermission[];
  write?: readonly AppPermission[];
  delete?: readonly AppPermission[];
};

const ANY_STAFF_PERMISSION = [
  "dashboard:view",
  "pos:use",
  "orders:view",
  "menu:manage",
  "inventory:view",
  "expenses:view",
  "staff:manage",
  "settings:manage",
  "branches:manage",
] as const satisfies readonly AppPermission[];

const TABLE_POLICIES: Record<string, DataPolicy> = {
  restaurants: { read: ANY_STAFF_PERMISSION, write: ["settings:manage"] },
  branches: { read: ANY_STAFF_PERMISSION, write: ["branches:manage"] },
  operating_hours: { read: ANY_STAFF_PERMISSION, write: ["settings:manage", "branches:manage"] },
  taxes: { read: ANY_STAFF_PERMISSION, write: ["settings:manage"] },
  profiles: { read: ANY_STAFF_PERMISSION, write: ["staff:manage"] },
  user_roles: { read: ANY_STAFF_PERMISSION, write: ["staff:manage"], delete: ["staff:manage"] },

  menu_categories: { read: ANY_STAFF_PERMISSION, write: ["menu:manage"] },
  menu_items: { read: ANY_STAFF_PERMISSION, write: ["menu:manage"] },

  orders: {
    read: ["dashboard:view", "pos:use", "orders:view", "receipts:view"],
    write: ["pos:use", "orders:manage"],
    delete: ["orders:admin"],
  },
  order_items: {
    read: ["pos:use", "orders:view", "receipts:view"],
    write: ["pos:use", "orders:manage"],
    delete: ["pos:use", "orders:manage"],
  },
  order_taxes: {
    read: ["pos:use", "orders:view", "receipts:view"],
    write: ["pos:use", "orders:manage"],
    delete: ["pos:use", "orders:manage"],
  },
  payments: {
    read: ["orders:view", "receipts:view"],
    write: ["pos:use", "orders:manage"],
  },
  finance_accounts: {
    read: ["dashboard:view", "expenses:view", "orders:view", "pos:use", "settings:manage"],
    write: ["expenses:manage", "settings:manage"],
    delete: ["settings:manage"],
  },
  finance_day_closures: {
    read: ["dashboard:view", "expenses:view"],
    write: ["expenses:manage"],
    delete: ["expenses:manage"],
  },
  finance_transfers: {
    read: ["dashboard:view", "expenses:view"],
    write: ["expenses:manage"],
    delete: ["expenses:manage"],
  },
  finance_movements: {
    read: ["dashboard:view", "expenses:view"],
  },
  finance_account_positions: {
    read: ["dashboard:view", "expenses:view"],
  },
  finance_obligations: {
    read: ["dashboard:view", "expenses:view", "orders:view", "customers:view"],
  },
  customers: {
    read: ["customers:view", "pos:use"],
    write: ["customers:manage", "pos:use", "orders:manage"],
  },
  customer_addresses: {
    read: ["customers:view", "pos:use"],
    write: ["customers:manage", "pos:use", "orders:manage"],
    delete: ["customers:manage"],
  },
  customer_events: {
    read: ["customers:view"],
    write: ["customers:manage", "pos:use", "orders:manage"],
  },
  coupon_campaigns: {
    read: ["customers:view", "orders:view", "pos:use"],
    write: ["customers:manage", "orders:adjust"],
    delete: ["customers:manage", "orders:adjust"],
  },
  coupon_redemptions: {
    read: ["customers:view", "orders:view"],
    write: ["pos:use", "orders:manage"],
  },
  homepage_promotions: {
    read: ["customers:view", "orders:view", "pos:use", "menu:manage"],
    write: ["customers:manage", "menu:manage"],
    delete: ["customers:manage", "menu:manage"],
  },
  job_posts: {
    read: ["staff:manage"],
    write: ["staff:manage"],
    delete: ["staff:manage"],
  },
  job_applications: {
    read: ["staff:manage"],
    write: ["staff:manage"],
    delete: ["staff:manage"],
  },
  customer_reviews: {
    read: ["customers:view", "orders:view"],
    write: ["customers:manage", "orders:manage"],
    delete: ["customers:manage"],
  },
  product_analytics_events: {
    read: ["dashboard:view", "customers:view", "menu:manage"],
    write: ["dashboard:view", "customers:manage", "menu:manage"],
  },

  inventory_items: {
    read: ["dashboard:view", "inventory:view", "menu:manage"],
    write: ["inventory:manage"],
    delete: ["inventory:manage"],
  },
  inventory_movements: {
    read: ["dashboard:view", "inventory:view"],
    write: ["inventory:manage"],
  },
  inventory_purchases: {
    read: ["inventory:view"],
    write: ["inventory:manage"],
    delete: ["inventory:manage"],
  },
  inventory_purchase_lines: {
    read: ["inventory:view"],
    write: ["inventory:manage"],
    delete: ["inventory:manage"],
  },
  inventory_unit_conversions: {
    read: ["inventory:view"],
    write: ["inventory:manage"],
    delete: ["inventory:manage"],
  },
  inventory_recipes: {
    read: ["inventory:view", "menu:manage"],
    write: ["inventory:manage"],
    delete: ["inventory:manage"],
  },
  inventory_cost_layers: {
    read: ["inventory:view"],
  },
  inventory_fifo_consumptions: {
    read: ["inventory:view"],
  },
  inventory_counts: {
    read: ["inventory:view"],
    write: ["inventory:manage"],
    delete: ["inventory:manage"],
  },
  inventory_count_lines: {
    read: ["inventory:view"],
    write: ["inventory:manage"],
    delete: ["inventory:manage"],
  },
  supplier_ledger_entries: {
    read: ["inventory:view", "expenses:view"],
  },
  suppliers: {
    read: ["inventory:view"],
    write: ["inventory:manage"],
    delete: ["inventory:manage"],
  },
  inventory_low_stock: { read: ["dashboard:view", "inventory:view"] },
  inventory_food_cost_by_menu_item: { read: ["inventory:view", "menu:manage"] },
  inventory_menu_performance: { read: ["dashboard:view", "inventory:view", "orders:view"] },

  operational_expenses: {
    read: ["dashboard:view", "expenses:view"],
    write: ["expenses:manage"],
    delete: ["expenses:manage"],
  },
  operational_expense_categories: {
    read: ["expenses:view"],
    write: ["expenses:manage"],
    delete: ["expenses:manage"],
  },
  recurring_operational_expenses: {
    read: ["dashboard:view", "expenses:view"],
    write: ["expenses:manage"],
    delete: ["expenses:manage"],
  },

  branch_printer_settings: {
    read: ["pos:use", "receipts:view", "settings:manage"],
    write: ["settings:manage"],
  },
};

const RPC_POLICIES: Record<string, readonly AppPermission[]> = {
  record_print: ["receipts:view"],
  record_payment: ["pos:use", "orders:manage"],
  get_menu_item_stock_status: ["pos:use", "inventory:view", "menu:manage"],
  create_pos_order: ["pos:use"],
  update_pos_order: ["pos:use"],
  cancel_order: ["orders:manage"],
  reopen_order: ["orders:manage"],
  delete_order_admin: ["orders:admin"],
  adjust_order_discount: ["orders:adjust"],
  void_order: ["orders:adjust"],
  refund_order: ["orders:adjust"],
  update_order_status: ["orders:manage"],
  set_order_customer_pending: ["orders:manage"],
  recalculate_customer_stats: ["customers:manage"],
  backfill_customer_records: ["customers:manage", "orders:manage"],
  clear_customer_dues_cutoff: ["customers:manage", "orders:manage"],
  record_inventory_purchase: ["inventory:manage"],
  record_inventory_adjustment: ["inventory:manage"],
  apply_inventory_count: ["inventory:manage"],
  record_supplier_payment: ["inventory:manage", "expenses:manage"],
  set_inventory_lock: ["inventory:manage", "settings:manage"],
  set_finance_cutover: ["expenses:manage", "settings:manage"],
};

const FilterSchema = z.object({
  op: z.enum(["eq", "neq", "gte", "lte", "lt", "gt", "in"]),
  column: z.string(),
  value: z.unknown(),
});

const OrderSchema = z.object({
  column: z.string(),
  ascending: z.boolean(),
});

const SelectSchema = z.object({
  table: z.string(),
  columns: z.string().default("*"),
  filters: z.array(FilterSchema).default([]),
  orders: z.array(OrderSchema).default([]),
  limit: z.number().int().positive().optional(),
  single: z.boolean().default(false),
  maybeSingle: z.boolean().default(false),
  head: z.boolean().default(false),
  count: z.boolean().default(false),
});

const InsertSchema = z.object({
  table: z.string(),
  values: z.union([z.record(z.unknown()), z.array(z.record(z.unknown()))]),
  returning: z.boolean().default(false),
});

const UpdateSchema = z.object({
  table: z.string(),
  values: z.record(z.unknown()),
  filters: z.array(FilterSchema).default([]),
  returning: z.boolean().default(false),
});

const DeleteSchema = z.object({
  table: z.string(),
  filters: z.array(FilterSchema).default([]),
});

const UpsertSchema = z.object({
  table: z.string(),
  values: z.union([z.record(z.unknown()), z.array(z.record(z.unknown()))]),
  conflictColumns: z.array(z.string()).min(1),
  returning: z.boolean().default(false),
});

const RpcSchema = z.object({
  fn: z.string(),
  args: z.record(z.unknown()).default({}),
});

export const postgresSelect = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => SelectSchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    await assertTableAccess(auth.userId, data.table, "read");
    const result = await runSelect(data);
    return result;
  });

export const postgresInsert = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => InsertSchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    assertWritableTable(data.table);
    await assertTableAccess(auth.userId, data.table, "write");
    return runInsert(data);
  });

export const postgresUpdate = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => UpdateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    assertWritableTable(data.table);
    await assertTableAccess(auth.userId, data.table, "write");
    return runUpdate(data);
  });

export const postgresDelete = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => DeleteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    assertWritableTable(data.table);
    await assertTableAccess(auth.userId, data.table, "delete");
    return runDelete(data);
  });

export const postgresUpsert = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => UpsertSchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    assertWritableTable(data.table);
    await assertTableAccess(auth.userId, data.table, "write");
    return runUpsert(data);
  });

export const postgresRpc = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => RpcSchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    await assertRpcAccess(auth.userId, data.fn);
    return runRpc(data.fn, data.args, auth.userId);
  });

async function runSelect(input: z.infer<typeof SelectSchema>) {
  if (input.table === "inventory_low_stock") {
    return selectVirtualRows(
      `select * from inventory_items where is_active = true and current_qty <= reorder_level`,
      input,
    );
  }

  if (input.table === "inventory_food_cost_by_menu_item") {
    return selectVirtualRows(
      `
      select
        mi.id as menu_item_id,
        mi.branch_id,
        mi.name,
        mi.base_price,
        coalesce(sum(ir.quantity * ii.average_cost), 0)::numeric as recipe_cost,
        case when mi.base_price::numeric > 0
          then (coalesce(sum(ir.quantity * ii.average_cost), 0) / mi.base_price::numeric) * 100
          else 0
        end::numeric as food_cost_percent
      from menu_items mi
      left join inventory_recipes ir on ir.menu_item_id = mi.id
      left join inventory_items ii on ii.id = ir.inventory_item_id
      group by mi.id, mi.branch_id, mi.base_price
      `,
      input,
    );
  }

  if (input.table === "inventory_menu_performance") {
    return selectInventoryMenuPerformance(input);
  }

  if (input.table === "finance_movements") {
    return selectVirtualRows(
      `
      select
        p.id,
        o.branch_id,
        p.paid_at as occurred_at,
        p.finance_account_id,
        coalesce(
          fa.name,
          case
            when p.method = 'cash' then 'Counter Cash'
            when p.method = 'wallet' then 'Wallet'
            when p.method = 'other' then 'Other'
            else 'Online'
          end
        ) as account_name,
        coalesce(
          fa.account_type::text,
          case
            when p.method = 'cash' then 'counter_cash'
            when p.method = 'wallet' then 'wallet'
            when p.method = 'other' then 'other'
            else 'online'
          end
        ) as account_type,
        coalesce(fa.is_cash, p.method = 'cash') as is_cash,
        'order_payment'::text as movement_type,
        o.order_no as title,
        p.method::text as payment_method,
        p.kind::text as payment_kind,
        p.amount::numeric as amount,
        p.reference
      from payments p
      join orders o on o.id = p.order_id
      join branches b on b.id = o.branch_id
      left join finance_accounts fa on fa.id = p.finance_account_id
      where p.paid_at >= coalesce(b.finance_cutover_at, '-infinity'::timestamp with time zone)
      union all
      select
        e.id,
        e.branch_id,
        ((e.expense_date::timestamp + time '12:00') at time zone 'Asia/Karachi') as occurred_at,
        e.finance_account_id,
        coalesce(fa.name, 'Not set') as account_name,
        coalesce(fa.account_type::text, 'other') as account_type,
        coalesce(fa.is_cash, e.payment_method = 'cash') as is_cash,
        'expense'::text as movement_type,
        e.title,
        e.payment_method::text as payment_method,
        e.status::text as payment_kind,
        (-e.amount)::numeric as amount,
        e.reference_no as reference
      from operational_expenses e
      join branches b on b.id = e.branch_id
      left join finance_accounts fa on fa.id = e.finance_account_id
      where e.status = 'paid'
        and ((e.expense_date::timestamp + time '12:00') at time zone 'Asia/Karachi')
          >= coalesce(b.finance_cutover_at, '-infinity'::timestamp with time zone)
      union all
      select
        ip.id,
        ip.branch_id,
        ((ip.purchase_date::timestamp + time '12:00') at time zone 'Asia/Karachi') as occurred_at,
        ip.finance_account_id,
        coalesce(fa.name, 'Not set') as account_name,
        coalesce(fa.account_type::text, 'other') as account_type,
        coalesce(fa.is_cash, false) as is_cash,
        'purchase_payment'::text as movement_type,
        coalesce(ip.invoice_no, 'Inventory purchase') as title,
        null::text as payment_method,
        'paid_purchase'::text as payment_kind,
        (-ip.total)::numeric as amount,
        ip.invoice_no as reference
      from inventory_purchases ip
      join branches b on b.id = ip.branch_id
      left join finance_accounts fa on fa.id = ip.finance_account_id
      where ip.finance_account_id is not null
        and ((ip.purchase_date::timestamp + time '12:00') at time zone 'Asia/Karachi')
          >= coalesce(b.finance_cutover_at, '-infinity'::timestamp with time zone)
      union all
      select
        sle.id,
        sle.branch_id,
        ((sle.occurred_on::timestamp + time '12:00') at time zone 'Asia/Karachi') as occurred_at,
        sle.finance_account_id,
        coalesce(fa.name, 'Not set') as account_name,
        coalesce(fa.account_type::text, 'other') as account_type,
        coalesce(fa.is_cash, false) as is_cash,
        'supplier_payment'::text as movement_type,
        coalesce(s.name, 'Supplier payment') as title,
        null::text as payment_method,
        'supplier_payment'::text as payment_kind,
        sle.amount::numeric as amount,
        sle.reference_no as reference
      from supplier_ledger_entries sle
      join branches b on b.id = sle.branch_id
      left join finance_accounts fa on fa.id = sle.finance_account_id
      left join suppliers s on s.id = sle.supplier_id
      where sle.entry_type = 'payment'
        and sle.finance_account_id is not null
        and ((sle.occurred_on::timestamp + time '12:00') at time zone 'Asia/Karachi')
          >= coalesce(b.finance_cutover_at, '-infinity'::timestamp with time zone)
      union all
      select
        t.id,
        t.branch_id,
        t.occurred_at,
        t.from_account_id as finance_account_id,
        coalesce(fa.name, 'Outside pocket') as account_name,
        coalesce(fa.account_type::text, 'other') as account_type,
        coalesce(fa.is_cash, false) as is_cash,
        'transfer_out'::text as movement_type,
        t.title,
        null::text as payment_method,
        t.transfer_type as payment_kind,
        (-t.amount)::numeric as amount,
        t.reference
      from finance_transfers t
      join branches b on b.id = t.branch_id
      left join finance_accounts fa on fa.id = t.from_account_id
      where t.from_account_id is not null
        and t.occurred_at >= coalesce(b.finance_cutover_at, '-infinity'::timestamp with time zone)
      union all
      select
        t.id,
        t.branch_id,
        t.occurred_at,
        t.to_account_id as finance_account_id,
        coalesce(fa.name, 'Outside pocket') as account_name,
        coalesce(fa.account_type::text, 'other') as account_type,
        coalesce(fa.is_cash, false) as is_cash,
        'transfer_in'::text as movement_type,
        t.title,
        null::text as payment_method,
        t.transfer_type as payment_kind,
        t.amount::numeric as amount,
        t.reference
      from finance_transfers t
      join branches b on b.id = t.branch_id
      left join finance_accounts fa on fa.id = t.to_account_id
      where t.to_account_id is not null
        and t.occurred_at >= coalesce(b.finance_cutover_at, '-infinity'::timestamp with time zone)
      `,
      input,
    );
  }

  if (input.table === "finance_account_positions") {
    return selectVirtualRows(
      `
      with movement_rows as (
        select
          p.finance_account_id,
          p.paid_at as occurred_at,
          p.amount::numeric as amount
        from payments p
        join orders o on o.id = p.order_id
        join branches b on b.id = o.branch_id
        where p.finance_account_id is not null
          and p.paid_at >= coalesce(b.finance_cutover_at, '-infinity'::timestamp with time zone)
        union all
        select
          e.finance_account_id,
          ((e.expense_date::timestamp + time '12:00') at time zone 'Asia/Karachi') as occurred_at,
          (-e.amount)::numeric as amount
        from operational_expenses e
        join branches b on b.id = e.branch_id
        where e.status = 'paid'
          and e.finance_account_id is not null
          and ((e.expense_date::timestamp + time '12:00') at time zone 'Asia/Karachi')
            >= coalesce(b.finance_cutover_at, '-infinity'::timestamp with time zone)
        union all
        select
          ip.finance_account_id,
          ((ip.purchase_date::timestamp + time '12:00') at time zone 'Asia/Karachi') as occurred_at,
          (-ip.total)::numeric as amount
        from inventory_purchases ip
        join branches b on b.id = ip.branch_id
        where ip.finance_account_id is not null
          and ((ip.purchase_date::timestamp + time '12:00') at time zone 'Asia/Karachi')
            >= coalesce(b.finance_cutover_at, '-infinity'::timestamp with time zone)
        union all
        select
          sle.finance_account_id,
          ((sle.occurred_on::timestamp + time '12:00') at time zone 'Asia/Karachi') as occurred_at,
          sle.amount::numeric as amount
        from supplier_ledger_entries sle
        join branches b on b.id = sle.branch_id
        where sle.entry_type = 'payment'
          and sle.finance_account_id is not null
          and ((sle.occurred_on::timestamp + time '12:00') at time zone 'Asia/Karachi')
            >= coalesce(b.finance_cutover_at, '-infinity'::timestamp with time zone)
        union all
        select t.from_account_id, t.occurred_at, (-t.amount)::numeric
        from finance_transfers t
        join branches b on b.id = t.branch_id
        where t.from_account_id is not null
          and t.occurred_at >= coalesce(b.finance_cutover_at, '-infinity'::timestamp with time zone)
        union all
        select t.to_account_id, t.occurred_at, t.amount::numeric
        from finance_transfers t
        join branches b on b.id = t.branch_id
        where t.to_account_id is not null
          and t.occurred_at >= coalesce(b.finance_cutover_at, '-infinity'::timestamp with time zone)
      ),
      branch_day as (
        select
          b.id as branch_id,
          case
            when (now() at time zone 'Asia/Karachi')::time < b.business_day_start_time
              then ((now() at time zone 'Asia/Karachi')::date - 1)
            else (now() at time zone 'Asia/Karachi')::date
          end as business_date,
          b.business_day_start_time
        from branches b
      ),
      branch_window as (
        select
          bd.branch_id,
          bd.business_date,
          ((bd.business_date + bd.business_day_start_time) at time zone 'Asia/Karachi') as start_at,
          (((bd.business_date + 1) + bd.business_day_start_time) at time zone 'Asia/Karachi') as end_at
        from branch_day bd
      ),
      latest_closure as (
        select distinct on (fdc.branch_id)
          fdc.branch_id,
          fdc.business_date,
          fdc.opening_cash::numeric as opening_cash,
          fdc.opening_online::numeric as opening_online,
          fdc.actual_cash::numeric as actual_cash,
          fdc.actual_online::numeric as actual_online,
          ((fdc.business_date + b.business_day_start_time) at time zone 'Asia/Karachi') as start_at,
          (((fdc.business_date + 1) + b.business_day_start_time) at time zone 'Asia/Karachi') as end_at
        from finance_day_closures fdc
        join branches b on b.id = fdc.branch_id
        where ((fdc.business_date + b.business_day_start_time) at time zone 'Asia/Karachi')
          >= coalesce(b.finance_cutover_at, '-infinity'::timestamp with time zone)
        order by fdc.branch_id, fdc.business_date desc, fdc.created_at desc
      ),
      ranked_accounts as (
        select
          fa.id,
          case
            when fa.is_cash or fa.account_type::text = 'counter_cash' then
              count(*) filter (
                where fa.is_cash or fa.account_type::text = 'counter_cash'
              ) over (
                partition by fa.branch_id
                order by fa.sort_order asc, fa.created_at asc
              )
            else null
          end as cash_rank,
          case
            when not coalesce(fa.is_cash, false)
              and fa.account_type::text in ('online', 'bank', 'wallet') then
              count(*) filter (
                where not coalesce(fa.is_cash, false)
                  and fa.account_type::text in ('online', 'bank', 'wallet')
              ) over (
                partition by fa.branch_id
                order by fa.sort_order asc, fa.created_at asc
              )
            else null
          end as online_rank
        from finance_accounts fa
        where fa.is_active = true
      ),
      account_baselines as (
        select
          fa.id as finance_account_id,
          case
            when (fa.is_cash or fa.account_type::text = 'counter_cash')
              and ra.cash_rank = 1 then coalesce(lc.actual_cash, lc.opening_cash, 0)
            when not coalesce(fa.is_cash, false)
              and fa.account_type::text in ('online', 'bank', 'wallet')
              and ra.online_rank = 1 then coalesce(lc.actual_online, lc.opening_online, 0)
            else 0
          end::numeric as baseline_balance,
          case
            when (fa.is_cash or fa.account_type::text = 'counter_cash')
              and ra.cash_rank = 1
              and lc.branch_id is not null then
                case when lc.actual_cash is not null then lc.end_at else lc.start_at end
            when not coalesce(fa.is_cash, false)
              and fa.account_type::text in ('online', 'bank', 'wallet')
              and ra.online_rank = 1
              and lc.branch_id is not null then
                case when lc.actual_online is not null then lc.end_at else lc.start_at end
            else coalesce(b.finance_cutover_at, '-infinity'::timestamp with time zone)
          end as baseline_at
        from finance_accounts fa
        join branches b on b.id = fa.branch_id
        left join ranked_accounts ra on ra.id = fa.id
        left join latest_closure lc on lc.branch_id = fa.branch_id
      ),
      movement_totals as (
        select
          mr.finance_account_id,
          coalesce(sum(mr.amount), 0)::numeric as all_time_movement,
          coalesce(sum(mr.amount) filter (
            where mr.occurred_at >= ab.baseline_at
          ), 0)::numeric as live_movement,
          coalesce(sum(mr.amount) filter (
            where mr.occurred_at >= bw.start_at and mr.occurred_at < bw.end_at
          ), 0)::numeric as current_shift_movement
        from movement_rows mr
        join finance_accounts fa on fa.id = mr.finance_account_id
        join branch_window bw on bw.branch_id = fa.branch_id
        join account_baselines ab on ab.finance_account_id = mr.finance_account_id
        group by mr.finance_account_id
      )
      select
        fa.id as account_id,
        fa.restaurant_id,
        fa.branch_id,
        fa.name,
        fa.account_type::text as account_type,
        fa.is_cash,
        fa.is_active,
        fa.sort_order,
        bw.business_date::text as business_date,
        coalesce(mt.all_time_movement, 0)::numeric as all_time_movement,
        coalesce(mt.current_shift_movement, 0)::numeric as current_shift_movement,
        (coalesce(ab.baseline_balance, 0) + coalesce(mt.live_movement, 0))::numeric as balance
      from finance_accounts fa
      join branch_window bw on bw.branch_id = fa.branch_id
      left join movement_totals mt on mt.finance_account_id = fa.id
      left join account_baselines ab on ab.finance_account_id = fa.id
      `,
      input,
    );
  }

  if (input.table === "finance_obligations") {
    return selectVirtualRows(
      `
      select
        o.id,
        o.branch_id,
        'receivable'::text as obligation_type,
        'order'::text as source_type,
        o.id as source_id,
        coalesce(nullif(o.customer_name, ''), nullif(o.customer_phone, ''), 'Walk-in customer') as counterparty_name,
        o.order_no as reference,
        greatest(o.grand_total::numeric - coalesce(o.amount_paid, 0)::numeric, 0)::numeric as amount,
        o.status::text as status,
        o.created_at as occurred_at,
        o.notes
      from orders o
      join branches b on b.id = o.branch_id
      where o.payment_status in ('pending', 'partial')
        and o.is_customer_pending = true
        and o.status not in ('cancelled', 'voided', 'refunded')
        and greatest(o.grand_total::numeric - coalesce(o.amount_paid, 0)::numeric, 0) > 0
        and o.created_at >= coalesce(b.finance_cutover_at, '-infinity'::timestamp with time zone)
      union all
      select
        e.id,
        e.branch_id,
        'payable'::text as obligation_type,
        'expense'::text as source_type,
        e.id as source_id,
        coalesce(nullif(e.vendor, ''), e.title, 'Expense due') as counterparty_name,
        coalesce(e.reference_no, e.title) as reference,
        e.amount::numeric as amount,
        e.status::text as status,
        ((e.expense_date::timestamp + time '12:00') at time zone 'Asia/Karachi') as occurred_at,
        e.notes
      from operational_expenses e
      join branches b on b.id = e.branch_id
      where e.status = 'due'
        and e.amount::numeric > 0
        and ((e.expense_date::timestamp + time '12:00') at time zone 'Asia/Karachi')
          >= coalesce(b.finance_cutover_at, '-infinity'::timestamp with time zone)
      union all
      select
        (ct.branch_id::text || ':credit:' || md5(ct.counterparty_key)) as id,
        ct.branch_id,
        'receivable'::text as obligation_type,
        'credit'::text as source_type,
        (ct.branch_id::text || ':credit:' || md5(ct.counterparty_key)) as source_id,
        ct.counterparty_name,
        ct.counterparty_name as reference,
        sum(ct.amount)::numeric as amount,
        'due'::text as status,
        max(ct.occurred_at) as occurred_at,
        'Money/credit given outside POS'::text as notes
      from (
        select
          t.branch_id,
          t.occurred_at,
          lower(coalesce(nullif(trim(t.reference), ''), trim(t.title), 'unknown credit')) as counterparty_key,
          coalesce(nullif(trim(t.reference), ''), trim(t.title), 'Credit account') as counterparty_name,
          case
            when t.transfer_type = 'credit_given' then t.amount::numeric
            when t.transfer_type = 'credit_collected' then (-t.amount)::numeric
            else 0::numeric
          end as amount
        from finance_transfers t
        join branches b on b.id = t.branch_id
        where t.transfer_type in ('credit_given', 'credit_collected')
          and t.occurred_at >= coalesce(b.finance_cutover_at, '-infinity'::timestamp with time zone)
      ) ct
      group by ct.branch_id, ct.counterparty_key, ct.counterparty_name
      having sum(ct.amount)::numeric > 0
      union all
      select
        (s.id::text || ':' || sle.branch_id::text) as id,
        sle.branch_id,
        'payable'::text as obligation_type,
        'supplier'::text as source_type,
        s.id as source_id,
        s.name as counterparty_name,
        'Supplier balance'::text as reference,
        sum(sle.amount)::numeric as amount,
        'due'::text as status,
        max(sle.created_at) as occurred_at,
        null::text as notes
      from supplier_ledger_entries sle
      join branches b on b.id = sle.branch_id
      join suppliers s on s.id = sle.supplier_id
      where ((sle.occurred_on::timestamp + time '12:00') at time zone 'Asia/Karachi')
        >= coalesce(b.finance_cutover_at, '-infinity'::timestamp with time zone)
      group by s.id, sle.branch_id, s.name
      having sum(sle.amount)::numeric > 0
      `,
      input,
    );
  }

  const params: unknown[] = [];
  const select = input.head ? "1" : normalizeSelectColumns(input.columns);
  const { where, params: filterParams } = buildWhere(input.filters, params.length);
  params.push(...filterParams);
  const order = buildOrder(input.orders);
  const limit =
    input.single || input.maybeSingle ? " limit 1" : input.limit ? ` limit ${input.limit}` : "";
  const sql = `select ${input.count ? "count(*)::int as count" : select} from ${ident(input.table)}${where}${order}${limit}`;
  const result = await pgPool.query(sql, params);

  let rows = input.count ? [] : result.rows;
  if (
    input.table === "operational_expenses" &&
    input.columns.includes("operational_expense_categories")
  ) {
    rows = await attachExpenseCategories(rows);
  }

  if (input.count) return { data: input.head ? null : rows, count: result.rows[0]?.count ?? 0 };
  if (input.single) return { data: rows[0] ?? null };
  if (input.maybeSingle) return { data: rows[0] ?? null };
  return { data: rows };
}

async function selectVirtualRows(
  baseSql: string,
  input: z.infer<typeof SelectSchema>,
  initialParams: unknown[] = [],
) {
  const params: unknown[] = [...initialParams];
  const { where, params: filterParams } = buildWhere(input.filters, params.length);
  params.push(...filterParams);
  const order = buildOrder(input.orders);
  const limit =
    input.single || input.maybeSingle ? " limit 1" : input.limit ? ` limit ${input.limit}` : "";
  const sql = `select ${input.count ? "count(*)::int as count" : normalizeSelectColumns(input.columns)} from (${baseSql}) v${where}${order}${limit}`;
  const result = await pgPool.query(sql, params);
  if (input.count) return { data: input.head ? null : [], count: result.rows[0]?.count ?? 0 };
  return { data: input.single || input.maybeSingle ? (result.rows[0] ?? null) : result.rows };
}

async function selectInventoryMenuPerformance(input: z.infer<typeof SelectSchema>) {
  const params: unknown[] = [];
  const salesWhere = ["o.status not in ('cancelled', 'voided', 'refunded')"];
  const filters = input.filters.filter((filter) => {
    if (filter.column !== "created_at") return true;
    const opMap = { gte: ">=", lte: "<=", lt: "<", gt: ">" } as const;
    const op = opMap[filter.op as keyof typeof opMap];
    if (!op) return true;
    params.push(normalizeValue(filter.value));
    salesWhere.push(`o.created_at ${op} $${params.length}`);
    return false;
  });

  const branchFilter = filters.find((filter) => filter.column === "branch_id");
  if (branchFilter?.op === "eq") {
    params.push(normalizeValue(branchFilter.value));
    salesWhere.push(`o.branch_id = $${params.length}`);
  }

  return selectVirtualRows(
    `
    with recipe_costs as (
      select
        ir.menu_item_id,
        coalesce(sum(ir.quantity::numeric * ii.average_cost::numeric), 0)::numeric as recipe_cost
      from inventory_recipes ir
      join inventory_items ii on ii.id = ir.inventory_item_id
      group by ir.menu_item_id
    ),
    sales as (
      select
        oi.item_id as menu_item_id,
        count(distinct o.id)::int as order_count,
        coalesce(sum(oi.qty::numeric), 0)::numeric as qty_sold,
        coalesce(sum(oi.line_subtotal::numeric), 0)::numeric as revenue
      from order_items oi
      join orders o on o.id = oi.order_id
      where ${salesWhere.join(" and ")}
      group by oi.item_id
    )
    select
      mi.id as menu_item_id,
      mi.branch_id,
      mi.name,
      mi.base_price,
      coalesce(rc.recipe_cost, 0)::numeric as recipe_cost,
      coalesce(s.order_count, 0)::int as order_count,
      coalesce(s.qty_sold, 0)::numeric as qty_sold,
      coalesce(s.revenue, 0)::numeric as revenue,
      (coalesce(rc.recipe_cost, 0) * coalesce(s.qty_sold, 0))::numeric as theoretical_food_cost,
      (coalesce(s.revenue, 0) - (coalesce(rc.recipe_cost, 0) * coalesce(s.qty_sold, 0)))::numeric as gross_profit,
      case when mi.base_price::numeric > 0
        then (coalesce(rc.recipe_cost, 0) / mi.base_price::numeric) * 100
        else 0
      end::numeric as food_cost_percent,
      case when coalesce(s.revenue, 0)::numeric > 0
        then ((coalesce(s.revenue, 0) - (coalesce(rc.recipe_cost, 0) * coalesce(s.qty_sold, 0))) / coalesce(s.revenue, 0)) * 100
        else 0
      end::numeric as gross_margin_percent
    from menu_items mi
    left join recipe_costs rc on rc.menu_item_id = mi.id
    left join sales s on s.menu_item_id = mi.id
    `,
    { ...input, filters },
    params,
  );
}

async function runInsert(input: z.infer<typeof InsertSchema>) {
  const rows = Array.isArray(input.values) ? input.values : [input.values];
  if (!rows.length) return { data: input.returning ? [] : null };
  if (input.table === "operational_expenses") {
    const client = await pgPool.connect();
    try {
      await client.query("begin");
      for (const row of rows) {
        await assertExpensePaymentSourceCanCover(client, row, 0);
      }
      const result = await insertRows(client, input.table, rows, input.returning);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  return insertRows(pgPool, input.table, rows, input.returning);
}

async function insertRows(
  client: Pick<PoolClient, "query">,
  table: string,
  rows: Record<string, unknown>[],
  returning: boolean,
) {
  const columns = Object.keys(rows[0]);
  const params: unknown[] = [];
  const valuesSql = rows
    .map((row) => {
      const placeholders = columns.map((column) => {
        params.push(normalizeValue(row[column]));
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    })
    .join(", ");
  const sql = `insert into ${ident(table)} (${columns.map(ident).join(", ")}) values ${valuesSql}${returning ? " returning *" : ""}`;
  const result = await client.query(sql, params);
  return { data: returning ? result.rows : null };
}

async function runUpdate(input: z.infer<typeof UpdateSchema>) {
  if (!input.filters.length) throw new Error("Refusing to update without a filter.");
  if (input.table === "operational_expenses") {
    const client = await pgPool.connect();
    try {
      await client.query("begin");
      const targets = await selectRowsForUpdate(client, input.table, input.filters);
      for (const target of targets) {
        const next = { ...target, ...input.values };
        const existingCredit =
          target.status === "paid" &&
          target.finance_account_id &&
          target.finance_account_id === next.finance_account_id
            ? Number(target.amount || 0)
            : 0;
        await assertExpensePaymentSourceCanCover(client, next, existingCredit);
      }
      const result = await updateRows(client, input.table, input.values, input.filters, input.returning);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  return updateRows(pgPool, input.table, input.values, input.filters, input.returning);
}

async function updateRows(
  client: Pick<PoolClient, "query">,
  table: string,
  values: Record<string, unknown>,
  filters: Array<z.infer<typeof FilterSchema>>,
  returning: boolean,
) {
  const params: unknown[] = [];
  const setSql = Object.entries(values)
    .map(([column, value]) => {
      params.push(normalizeValue(value));
      return `${ident(column)} = $${params.length}`;
    })
    .join(", ");
  const { where, params: filterParams } = buildWhere(filters, params.length);
  params.push(...filterParams);
  const result = await client.query(
    `update ${ident(table)} set ${setSql}${where}${returning ? " returning *" : ""}`,
    params,
  );
  return { data: returning ? result.rows : null };
}

async function runDelete(input: z.infer<typeof DeleteSchema>) {
  if (!input.filters.length) throw new Error("Refusing to delete without a filter.");
  const params: unknown[] = [];
  const { where, params: filterParams } = buildWhere(input.filters, params.length);
  params.push(...filterParams);
  await pgPool.query(`delete from ${ident(input.table)}${where}`, params);
  return { data: null };
}

async function runUpsert(input: z.infer<typeof UpsertSchema>) {
  const rows = Array.isArray(input.values) ? input.values : [input.values];
  if (!rows.length) return { data: input.returning ? [] : null };
  const columns = Object.keys(rows[0]);
  const params: unknown[] = [];
  const valuesSql = rows
    .map((row) => {
      const placeholders = columns.map((column) => {
        params.push(normalizeValue(row[column]));
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    })
    .join(", ");
  const updateColumns = columns.filter((column) => !input.conflictColumns.includes(column));
  const setSql = updateColumns
    .map((column) => `${ident(column)} = excluded.${ident(column)}`)
    .join(", ");
  const sql = `insert into ${ident(input.table)} (${columns.map(ident).join(", ")}) values ${valuesSql} on conflict (${input.conflictColumns.map(ident).join(", ")}) do update set ${setSql}${input.returning ? " returning *" : ""}`;
  const result = await pgPool.query(sql, params);
  return { data: input.returning ? result.rows : null };
}

async function selectRowsForUpdate(
  client: PoolClient,
  table: string,
  filters: Array<z.infer<typeof FilterSchema>>,
) {
  const params: unknown[] = [];
  const { where, params: filterParams } = buildWhere(filters, params.length);
  params.push(...filterParams);
  const result = await client.query(`select * from ${ident(table)}${where} for update`, params);
  return result.rows as Record<string, unknown>[];
}

async function assertExpensePaymentSourceCanCover(
  client: PoolClient,
  expense: Record<string, unknown>,
  existingCredit: number,
) {
  if (expense.status !== "paid") return;
  const branchId = nullableText(expense.branch_id);
  const accountId = nullableText(expense.finance_account_id);
  const amount = Number(expense.amount ?? 0);
  if (!branchId || !accountId || !Number.isFinite(amount) || amount <= 0) return;

  const account = await client.query(
    `select id, name, account_type::text as account_type, is_cash
       from finance_accounts
      where id = $1 and branch_id = $2 and is_active = true
      for update`,
    [accountId, branchId],
  );
  const row = account.rows[0];
  if (!row) throw new Error("Payment source is not available for this branch.");
  if (!financeAccountRequiresBalance(row.account_type)) return;

  const balance = await getLiveFinanceAccountBalance(client, branchId, accountId);
  const available = balance + existingCredit;
  if (amount > available + 0.001) {
    throw new Error(
      `${row.name} has ${moneyString(available)} available. Mark this expense as due or use pocket/backup money.`,
    );
  }
}

function financeAccountRequiresBalance(accountType: unknown) {
  return ["counter_cash", "online", "bank", "wallet"].includes(String(accountType ?? ""));
}

async function getLiveFinanceAccountBalance(
  client: PoolClient,
  branchId: string,
  accountId: string,
) {
  const result = await client.query(
    `
    with branch_day as (
      select
        b.id as branch_id,
        case
          when (now() at time zone 'Asia/Karachi')::time < b.business_day_start_time
            then ((now() at time zone 'Asia/Karachi')::date - 1)
          else (now() at time zone 'Asia/Karachi')::date
        end as business_date,
        b.business_day_start_time,
        b.finance_cutover_at
      from branches b
      where b.id = $1
    ),
    branch_window as (
      select
        bd.branch_id,
        bd.business_date,
        bd.finance_cutover_at,
        ((bd.business_date + bd.business_day_start_time) at time zone 'Asia/Karachi') as start_at,
        (((bd.business_date + 1) + bd.business_day_start_time) at time zone 'Asia/Karachi') as end_at
      from branch_day bd
    ),
    latest_closure as (
      select distinct on (fdc.branch_id)
        fdc.branch_id,
        fdc.business_date,
        fdc.opening_cash::numeric as opening_cash,
        fdc.opening_online::numeric as opening_online,
        fdc.actual_cash::numeric as actual_cash,
        fdc.actual_online::numeric as actual_online,
        ((fdc.business_date + b.business_day_start_time) at time zone 'Asia/Karachi') as start_at,
        (((fdc.business_date + 1) + b.business_day_start_time) at time zone 'Asia/Karachi') as end_at
      from finance_day_closures fdc
      join branches b on b.id = fdc.branch_id
      where fdc.branch_id = $1
        and ((fdc.business_date + b.business_day_start_time) at time zone 'Asia/Karachi')
          >= coalesce(b.finance_cutover_at, '-infinity'::timestamp with time zone)
      order by fdc.branch_id, fdc.business_date desc, fdc.created_at desc
    ),
    ranked_accounts as (
      select
        fa.id,
        case
          when fa.is_cash or fa.account_type::text = 'counter_cash' then
            count(*) filter (
              where fa.is_cash or fa.account_type::text = 'counter_cash'
            ) over (
              partition by fa.branch_id
              order by fa.sort_order asc, fa.created_at asc
            )
          else null
        end as cash_rank,
        case
          when not coalesce(fa.is_cash, false)
            and fa.account_type::text in ('online', 'bank', 'wallet') then
            count(*) filter (
              where not coalesce(fa.is_cash, false)
                and fa.account_type::text in ('online', 'bank', 'wallet')
            ) over (
              partition by fa.branch_id
              order by fa.sort_order asc, fa.created_at asc
            )
          else null
        end as online_rank
      from finance_accounts fa
      where fa.branch_id = $1 and fa.is_active = true
    ),
    account_baseline as (
      select
        case
          when (fa.is_cash or fa.account_type::text = 'counter_cash')
            and ra.cash_rank = 1 then coalesce(lc.actual_cash, lc.opening_cash, 0)
          when not coalesce(fa.is_cash, false)
            and fa.account_type::text in ('online', 'bank', 'wallet')
            and ra.online_rank = 1 then coalesce(lc.actual_online, lc.opening_online, 0)
          else 0
        end::numeric as baseline_balance,
        case
          when (fa.is_cash or fa.account_type::text = 'counter_cash')
            and ra.cash_rank = 1
            and lc.branch_id is not null then
              case when lc.actual_cash is not null then lc.end_at else lc.start_at end
          when not coalesce(fa.is_cash, false)
            and fa.account_type::text in ('online', 'bank', 'wallet')
            and ra.online_rank = 1
            and lc.branch_id is not null then
              case when lc.actual_online is not null then lc.end_at else lc.start_at end
          else coalesce(bd.finance_cutover_at, '-infinity'::timestamp with time zone)
        end as baseline_at
      from finance_accounts fa
      join branch_day bd on bd.branch_id = fa.branch_id
      left join ranked_accounts ra on ra.id = fa.id
      left join latest_closure lc on lc.branch_id = fa.branch_id
      where fa.id = $2 and fa.branch_id = $1
    ),
    movement_rows as (
      select p.finance_account_id, p.paid_at as occurred_at, p.amount::numeric as amount
      from payments p
      join orders o on o.id = p.order_id
      join branch_window bw on bw.branch_id = o.branch_id
      where p.finance_account_id = $2
        and p.paid_at >= coalesce(bw.finance_cutover_at, '-infinity'::timestamp with time zone)
      union all
      select e.finance_account_id,
        ((e.expense_date::timestamp + time '12:00') at time zone 'Asia/Karachi'),
        (-e.amount)::numeric
      from operational_expenses e
      join branch_window bw on bw.branch_id = e.branch_id
      where e.status = 'paid'
        and e.finance_account_id = $2
        and ((e.expense_date::timestamp + time '12:00') at time zone 'Asia/Karachi')
          >= coalesce(bw.finance_cutover_at, '-infinity'::timestamp with time zone)
      union all
      select ip.finance_account_id,
        ((ip.purchase_date::timestamp + time '12:00') at time zone 'Asia/Karachi'),
        (-ip.total)::numeric
      from inventory_purchases ip
      join branch_window bw on bw.branch_id = ip.branch_id
      where ip.finance_account_id = $2
        and ((ip.purchase_date::timestamp + time '12:00') at time zone 'Asia/Karachi')
          >= coalesce(bw.finance_cutover_at, '-infinity'::timestamp with time zone)
      union all
      select sle.finance_account_id,
        ((sle.occurred_on::timestamp + time '12:00') at time zone 'Asia/Karachi'),
        sle.amount::numeric
      from supplier_ledger_entries sle
      join branch_window bw on bw.branch_id = sle.branch_id
      where sle.entry_type = 'payment'
        and sle.finance_account_id = $2
        and ((sle.occurred_on::timestamp + time '12:00') at time zone 'Asia/Karachi')
          >= coalesce(bw.finance_cutover_at, '-infinity'::timestamp with time zone)
      union all
      select t.from_account_id, t.occurred_at, (-t.amount)::numeric
      from finance_transfers t
      join branch_window bw on bw.branch_id = t.branch_id
      where t.from_account_id = $2
        and t.occurred_at >= coalesce(bw.finance_cutover_at, '-infinity'::timestamp with time zone)
      union all
      select t.to_account_id, t.occurred_at, t.amount::numeric
      from finance_transfers t
      join branch_window bw on bw.branch_id = t.branch_id
      where t.to_account_id = $2
        and t.occurred_at >= coalesce(bw.finance_cutover_at, '-infinity'::timestamp with time zone)
    )
    select
      (coalesce((select baseline_balance from account_baseline), 0) +
       coalesce(sum(mr.amount) filter (
         where mr.occurred_at >= (select baseline_at from account_baseline)
       ), 0))::numeric as balance
    from branch_window bw
    left join movement_rows mr on true
    group by bw.branch_id
    `,
    [branchId, accountId],
  );
  return Number(result.rows[0]?.balance ?? 0);
}

async function runRpc(fn: string, args: Record<string, unknown>, actorId: string) {
  switch (fn) {
    case "record_print":
      return recordPrint(args);
    case "record_payment":
      return recordPayment(args, actorId);
    case "get_menu_item_stock_status":
      return getMenuItemStockStatus(args);
    case "create_pos_order":
      return createPosOrder(args, actorId);
    case "update_pos_order":
      return updatePosOrder(args, actorId);
    case "cancel_order":
      return updateOrderStatus(args, actorId, "cancelled");
    case "reopen_order":
      return updateOrderStatus(args, actorId, "served");
    case "delete_order_admin":
      return deleteOrderAdmin(args);
    case "adjust_order_discount":
      return adjustOrderDiscount(args, actorId);
    case "void_order":
      return voidOrder(args, actorId);
    case "refund_order":
      return refundOrder(args, actorId);
    case "update_order_status":
      return updateOrderStatus(args, actorId, String(args._status ?? ""));
    case "set_order_customer_pending":
      return setOrderCustomerPending(args, actorId);
    case "recalculate_customer_stats":
      return recalculateCustomerStats(String(args._customer_id ?? ""));
    case "backfill_customer_records":
      return backfillCustomerRecords(args, actorId);
    case "clear_customer_dues_cutoff":
      return clearCustomerDuesCutoff(args, actorId);
    case "record_inventory_purchase":
      return recordInventoryPurchase(args, actorId);
    case "record_inventory_adjustment":
      return recordInventoryAdjustment(args, actorId);
    case "apply_inventory_count":
      return applyInventoryCount(args, actorId);
    case "record_supplier_payment":
      return recordSupplierPayment(args, actorId);
    case "set_inventory_lock":
      return setInventoryLock(args, actorId);
    case "set_finance_cutover":
      return setFinanceCutover(args, actorId);
    default:
      throw new Error(`PostgreSQL RPC is not wired yet: ${fn}`);
  }
}

async function recordPrint(args: Record<string, unknown>) {
  const orderId = String(args._order_id ?? "");
  const kind = String(args._kind ?? "");
  const column =
    kind === "kot"
      ? "kot_print_count"
      : kind === "bill"
        ? "bill_print_count"
        : kind === "receipt"
          ? "receipt_print_count"
          : null;
  if (!orderId || !column) throw new Error("Invalid print request.");
  await pgPool.query(`update orders set ${ident(column)} = ${ident(column)} + 1 where id = $1`, [
    orderId,
  ]);
  return { data: null };
}

async function resolveFinanceAccountId(
  client: PoolClient,
  branchId: string,
  method: string,
  requestedAccountId: unknown,
) {
  const requested = typeof requestedAccountId === "string" ? requestedAccountId.trim() : "";
  if (requested) {
    const check = await client.query(
      `select id from finance_accounts where id = $1 and branch_id = $2 and is_active = true`,
      [requested, branchId],
    );
    if (!check.rowCount) throw new Error("Payment source is not available for this branch.");
    return requested;
  }

  const targetTypes =
    method === "cash"
      ? ["counter_cash"]
      : method === "wallet"
        ? ["wallet", "online", "bank"]
        : method === "other"
          ? ["other"]
          : ["online", "bank", "wallet"];
  const result = await client.query(
    `select id
       from finance_accounts
      where branch_id = $1 and account_type::text = any($2::text[]) and is_active = true
      order by array_position($2::text[], account_type::text), sort_order asc, created_at asc
      limit 1`,
    [branchId, targetTypes],
  );
  if (!result.rows[0]?.id) {
    throw new Error("Set up an active finance source for this payment method first.");
  }
  return result.rows[0].id;
}

async function recordPayment(args: Record<string, unknown>, actorId: string) {
  const client = await pgPool.connect();
  const orderId = String(args._order_id ?? "");
  const method = String(args._method ?? "cash");
  const amount = Number(args._amount ?? 0);
  const reference = args._reference ? String(args._reference) : null;
  if (!orderId || !Number.isFinite(amount) || amount <= 0) throw new Error("Invalid payment.");

  await client.query("begin");
  try {
    const orderScope = await client.query(`select branch_id from orders where id = $1 for update`, [
      orderId,
    ]);
    const branchId = orderScope.rows[0]?.branch_id;
    if (!branchId) throw new Error("Order was not found.");
    const financeAccountId = await resolveFinanceAccountId(
      client,
      String(branchId),
      method,
      args._finance_account_id,
    );
    await client.query(
      `insert into payments (order_id, method, kind, finance_account_id, amount, reference, received_by)
       values ($1, $2, 'payment', $3, $4, $5, $6)`,
      [orderId, method, financeAccountId, amount.toFixed(2), reference, actorId],
    );
    const result = await client.query(
      `update orders
       set amount_paid = amount_paid + $2::numeric,
           payment_status = case
             when amount_paid + $2::numeric >= grand_total then 'paid'::payment_status
             when amount_paid + $2::numeric > 0 then 'partial'::payment_status
             else 'pending'::payment_status
           end,
           updated_at = now()
       where id = $1
       returning id, customer_id, order_no, status, payment_status, grand_total`,
      [orderId, amount.toFixed(2)],
    );
    if (!result.rowCount) throw new Error("Order was not found.");
    await recalculateCustomerStatsForOrder(client, orderId);
    const order = result.rows[0];
    if (order.customer_id && order.status === "completed" && order.payment_status === "paid") {
      await recordLoyaltyEarnedEvent(client, {
        customerId: String(order.customer_id),
        orderId,
        orderNo: String(order.order_no),
        grandTotal: Number(order.grand_total),
      });
    }
    await client.query("commit");
    return { data: null };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function backfillCustomerRecords(args: Record<string, unknown>, actorId: string) {
  const branchId = String(args._branch_id ?? "");
  if (!branchId) throw new Error("Branch is required.");

  const client = await pgPool.connect();
  const touchedCustomerIds = new Set<string>();
  let linked = 0;

  try {
    await client.query("begin");
    const branchResult = await client.query<{
      id: string;
      restaurant_id: string;
    }>(
      `
      select b.id, b.restaurant_id
      from branches b
      where b.id = $1
        and exists (
          select 1
          from user_roles ur
          where ur.user_id = $2
            and ur.restaurant_id = b.restaurant_id
            and (ur.branch_id is null or ur.branch_id = b.id)
        )
      `,
      [branchId, actorId],
    );
    const branch = branchResult.rows[0];
    if (!branch) throw new Error("Branch was not found or you do not have access.");

    const ordersResult = await client.query<{
      id: string;
      order_no: string;
      customer_name: string | null;
      customer_phone: string | null;
      notes: string | null;
      grand_total: string | number;
    }>(
      `
      select id, order_no, customer_name, customer_phone, notes, grand_total
      from orders
      where branch_id = $1
        and customer_id is null
        and nullif(trim(coalesce(customer_name, '')), '') is not null
      order by created_at asc
      limit 2000
      for update
      `,
      [branchId],
    );

    for (const order of ordersResult.rows) {
      const customer = await findOrCreateOrderCustomer(client, {
        restaurantId: branch.restaurant_id,
        branchId,
        name: order.customer_name,
        phone: order.customer_phone,
        notes: order.notes,
      });
      if (!customer) continue;

      await client.query("update orders set customer_id = $2 where id = $1", [
        order.id,
        customer.id,
      ]);
      await client.query(
        `
        insert into customer_events (customer_id, restaurant_id, branch_id, order_id, event_type, meta)
        select $1, $2, $3, $4, 'order_placed', jsonb_build_object('order_no', $5::text, 'grand_total', $6::numeric)
        where not exists (
          select 1
          from customer_events
          where customer_id = $1
            and order_id = $4
            and event_type = 'order_placed'
        )
        `,
        [
          customer.id,
          branch.restaurant_id,
          branchId,
          order.id,
          order.order_no,
          moneyString(Number(order.grand_total || 0)),
        ],
      );
      touchedCustomerIds.add(customer.id);
      linked += 1;
    }

    for (const customerId of touchedCustomerIds) {
      await recalculateCustomerStats(customerId, client);
    }

    await client.query("commit");
    return { data: { linked, customers: touchedCustomerIds.size } };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function clearCustomerDuesCutoff(args: Record<string, unknown>, actorId: string) {
  const branchId = String(args._branch_id ?? "");
  if (!branchId) throw new Error("Branch is required.");

  const result = await pgPool.query<{ customer_dues_cutoff_at: Date }>(
    `
    update branches b
    set customer_dues_cutoff_at = now(),
        updated_at = now()
    where b.id = $1
      and exists (
        select 1
        from user_roles ur
        where ur.user_id = $2
          and ur.restaurant_id = b.restaurant_id
          and (ur.branch_id is null or ur.branch_id = b.id)
      )
    returning customer_dues_cutoff_at
    `,
    [branchId, actorId],
  );
  const cutoffAt = result.rows[0]?.customer_dues_cutoff_at;
  if (!cutoffAt) throw new Error("Branch was not found or you do not have access.");
  return { data: { cutoffAt: cutoffAt.toISOString() } };
}

async function assertInventoryPeriodOpen(
  client: PoolClient,
  branchId: string,
  occurredAt: string | Date,
) {
  const date =
    typeof occurredAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(occurredAt)
      ? new Date(`${occurredAt}T00:00:00+05:00`)
      : new Date(occurredAt);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid inventory date.");

  const result = await client.query("select inventory_locked_before from branches where id = $1", [
    branchId,
  ]);
  const lockedBefore = result.rows[0]?.inventory_locked_before;
  if (lockedBefore && date < new Date(lockedBefore)) {
    throw new Error("This inventory period is locked. Post a current correction instead.");
  }
}

async function createInventoryCostLayer(
  client: PoolClient,
  input: {
    branchId: string;
    itemId: string;
    sourcePurchaseLineId?: string | null;
    sourceMovementId?: string | null;
    receivedAt?: string | Date;
    quantity: number;
    unitCost: number;
  },
) {
  if (input.quantity <= 0) return;
  await client.query(
    `insert into inventory_cost_layers
       (branch_id, inventory_item_id, source_purchase_line_id, source_movement_id,
        received_at, quantity_received, quantity_remaining, unit_cost)
     values ($1, $2, $3, $4, $5, $6, $6, $7)`,
    [
      input.branchId,
      input.itemId,
      input.sourcePurchaseLineId ?? null,
      input.sourceMovementId ?? null,
      input.receivedAt ?? new Date(),
      baseQuantityString(input.quantity),
      Number.isFinite(input.unitCost) ? input.unitCost.toFixed(6) : "0",
    ],
  );
}

async function reserveFifoConsumption(
  client: PoolClient,
  input: { branchId: string; itemId: string; quantity: number; fallbackUnitCost: number },
) {
  let remaining = roundQuantity(input.quantity);
  let totalCost = 0;
  const rows: Array<{
    layerId: string | null;
    quantity: number;
    unitCost: number;
    totalCost: number;
  }> = [];
  const layers = await client.query(
    `select id, quantity_remaining, unit_cost
       from inventory_cost_layers
      where branch_id = $1
        and inventory_item_id = $2
        and quantity_remaining::numeric > 0
      order by received_at asc, created_at asc, id asc
      for update`,
    [input.branchId, input.itemId],
  );

  for (const layer of layers.rows) {
    if (remaining <= 0) break;
    const available = Number(layer.quantity_remaining);
    const consume = roundQuantity(Math.min(available, remaining));
    if (consume <= 0) continue;
    const after = roundQuantity(available - consume);
    const unitCost = Number(layer.unit_cost || 0);
    const lineTotal = roundMoney(consume * unitCost);
    await client.query("update inventory_cost_layers set quantity_remaining = $2 where id = $1", [
      layer.id,
      baseQuantityString(after),
    ]);
    rows.push({ layerId: layer.id, quantity: consume, unitCost, totalCost: lineTotal });
    totalCost += lineTotal;
    remaining = roundQuantity(remaining - consume);
  }

  if (remaining > 0) {
    const unitCost = Number.isFinite(input.fallbackUnitCost) ? input.fallbackUnitCost : 0;
    const lineTotal = roundMoney(remaining * unitCost);
    rows.push({ layerId: null, quantity: remaining, unitCost, totalCost: lineTotal });
    totalCost += lineTotal;
  }

  return {
    unitCost: input.quantity > 0 ? totalCost / input.quantity : 0,
    totalCost,
    rows,
  };
}

async function insertFifoConsumptionRows(
  client: PoolClient,
  input: {
    branchId: string;
    itemId: string;
    movementId: string;
    rows: Array<{ layerId: string | null; quantity: number; unitCost: number; totalCost: number }>;
  },
) {
  for (const row of input.rows) {
    await client.query(
      `insert into inventory_fifo_consumptions
         (branch_id, inventory_item_id, movement_id, cost_layer_id, quantity, unit_cost, total_cost)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.branchId,
        input.itemId,
        input.movementId,
        row.layerId,
        baseQuantityString(row.quantity),
        row.unitCost.toFixed(6),
        moneyString(row.totalCost),
      ],
    );
  }
}

async function recordInventoryPurchase(args: Record<string, unknown>, actorId: string) {
  const branchId = String(args._branch ?? "");
  const supplierId = nullableText(args._supplier);
  const financeAccountId = nullableText(args._finance_account);
  const invoiceNo = nullableText(args._invoice_no);
  const purchaseDate = nullableText(args._purchase_date) ?? new Date().toISOString().slice(0, 10);
  const note = nullableText(args._notes);
  const lines = Array.isArray(args._lines) ? (args._lines as Array<Record<string, unknown>>) : [];
  if (!branchId || lines.length === 0) throw new Error("Purchase needs at least one line.");
  if (!financeAccountId) throw new Error("Select the payment source for this purchase.");

  const client = await pgPool.connect();
  try {
    await client.query("begin");
    const branchResult = await client.query(
      "select id, restaurant_id from branches where id = $1",
      [branchId],
    );
    const branch = branchResult.rows[0];
    if (!branch) throw new Error("Branch was not found.");
    await assertInventoryPeriodOpen(client, branchId, purchaseDate);
    if (supplierId) {
      const supplier = await client.query(
        "select id from suppliers where id = $1 and restaurant_id = $2 and is_active = true",
        [supplierId, branch.restaurant_id],
      );
      if (!supplier.rowCount) throw new Error("Supplier was not found.");
    }
    if (financeAccountId) {
      const source = await client.query(
        "select id from finance_accounts where id = $1 and branch_id = $2 and is_active = true",
        [financeAccountId, branchId],
      );
      if (!source.rowCount) throw new Error("Payment source is not available for this branch.");
    }

    const purchaseResult = await client.query(
      `insert into inventory_purchases
         (branch_id, supplier_id, finance_account_id, invoice_no, purchase_date, notes, total, created_by)
       values ($1, $2, $3, $4, $5, $6, 0, $7)
       returning id`,
      [branchId, supplierId, financeAccountId, invoiceNo, purchaseDate, note, actorId],
    );
    const purchaseId = String(purchaseResult.rows[0].id);
    let total = 0;

    for (const line of lines) {
      const itemId = String(line.inventory_item_id ?? "");
      const quantity = Number(line.quantity ?? 0);
      const unit = String(line.unit ?? "");
      const conversionInput = line.conversion_factor ?? line.pack_size ?? null;
      const unitCost = Number(line.unit_cost ?? 0);
      if (!itemId || !Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Every purchase line needs a valid ingredient and positive quantity.");
      }
      if (!Number.isFinite(unitCost) || unitCost < 0)
        throw new Error("Unit cost cannot be negative.");

      const itemResult = await client.query(
        `select id, base_unit, current_qty, average_cost
         from inventory_items
         where id = $1 and branch_id = $2 and is_active = true
         for update`,
        [itemId, branchId],
      );
      const item = itemResult.rows[0];
      if (!item) throw new Error("Inventory item was not found in this branch.");
      const baseUnit = String(item.base_unit) as InventoryBaseUnit;
      const factor = unitFactorToBase(baseUnit, unit, conversionInput as number | string | null);
      const baseQuantity = roundQuantity(quantity * factor);
      const lineTotal = roundMoney(quantity * unitCost);
      const beforeQty = Number(item.current_qty);
      const afterQty = roundQuantity(beforeQty + baseQuantity);
      const currentValue = Math.max(0, beforeQty) * Number(item.average_cost);
      const averageCost =
        afterQty > 0 ? (currentValue + lineTotal) / afterQty : Number(item.average_cost);

      const purchaseLineResult = await client.query(
        `insert into inventory_purchase_lines
         (purchase_id, inventory_item_id, quantity, unit, pack_size, conversion_factor,
            base_quantity, unit_cost, line_total)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning id`,
        [
          purchaseId,
          itemId,
          quantity,
          unit,
          line.pack_size ?? null,
          factor,
          baseQuantity,
          unitCost,
          moneyString(lineTotal),
        ],
      );
      await client.query(
        `update inventory_items
         set current_qty = $2, average_cost = $3, updated_at = now()
         where id = $1`,
        [itemId, baseQuantityString(afterQty), averageCost.toFixed(6)],
      );
      const movementResult = await client.query(
        `insert into inventory_movements
           (branch_id, inventory_item_id, movement_type, reason, quantity_delta,
            before_qty, after_qty, unit_cost, entered_quantity, entered_unit, conversion_factor,
            related_purchase_id, actor_id, note)
         values ($1, $2, 'purchase', 'purchase', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         returning id`,
        [
          branchId,
          itemId,
          baseQuantityString(baseQuantity),
          baseQuantityString(beforeQty),
          baseQuantityString(afterQty),
          baseQuantity > 0 ? (lineTotal / baseQuantity).toFixed(6) : "0",
          quantity,
          unit,
          factor,
          purchaseId,
          actorId,
          note,
        ],
      );
      await createInventoryCostLayer(client, {
        branchId,
        itemId,
        sourcePurchaseLineId: purchaseLineResult.rows[0].id,
        sourceMovementId: movementResult.rows[0].id,
        receivedAt: purchaseDate,
        quantity: baseQuantity,
        unitCost: baseQuantity > 0 ? lineTotal / baseQuantity : 0,
      });
      total += lineTotal;
    }

    await client.query("update inventory_purchases set total = $2 where id = $1", [
      purchaseId,
      moneyString(total),
    ]);
    await client.query(
      `insert into audit_log
         (restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
       values ($1, $2, $3, 'inventory_purchase', $4, 'recorded', jsonb_build_object('total', $5::numeric))`,
      [branch.restaurant_id, branchId, actorId, purchaseId, moneyString(total)],
    );
    if (supplierId && total > 0) {
      await client.query(
        `insert into supplier_ledger_entries
           (restaurant_id, branch_id, supplier_id, entry_type, purchase_id, amount,
            reference_no, occurred_on, notes, created_by)
         values ($1, $2, $3, 'purchase', $4, $5, $6, $7, $8, $9)`,
        [
          branch.restaurant_id,
          branchId,
          supplierId,
          purchaseId,
          moneyString(total),
          invoiceNo,
          purchaseDate,
          note,
          actorId,
        ],
      );
      if (financeAccountId) {
        await client.query(
          `insert into supplier_ledger_entries
             (restaurant_id, branch_id, supplier_id, entry_type, purchase_id, amount,
              reference_no, occurred_on, notes, created_by)
           values ($1, $2, $3, 'payment', $4, $5, $6, $7, $8, $9)`,
          [
            branch.restaurant_id,
            branchId,
            supplierId,
            purchaseId,
            moneyString(-total),
            invoiceNo,
            purchaseDate,
            note ? `Paid purchase. ${note}` : "Paid purchase",
            actorId,
          ],
        );
      }
    }
    await client.query("commit");
    return [{ purchase_id: purchaseId, total: moneyString(total) }];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function recordInventoryAdjustment(args: Record<string, unknown>, actorId: string) {
  const itemId = String(args._item ?? "");
  const movementType = String(args._movement_type ?? "adjustment");
  const reason = String(args._reason ?? "other");
  const enteredQuantity = Number(args._entered_quantity ?? args._quantity_delta ?? 0);
  const enteredUnit = nullableText(args._unit);
  const conversionInput = args._conversion_factor ?? null;
  const note = nullableText(args._note);
  const validTypes = new Set(["adjustment", "waste", "correction", "staff_meal", "damage"]);
  const validReasons = new Set(["waste", "damage", "correction", "staff_meal", "other"]);
  if (!itemId || !validTypes.has(movementType) || !validReasons.has(reason)) {
    throw new Error("Invalid inventory adjustment.");
  }
  if (!Number.isFinite(enteredQuantity) || enteredQuantity === 0) {
    throw new Error("Quantity adjustment cannot be zero.");
  }

  const client = await pgPool.connect();
  try {
    await client.query("begin");
    const itemResult = await client.query(
      `select ii.*, b.restaurant_id
       from inventory_items ii join branches b on b.id = ii.branch_id
       where ii.id = $1 for update`,
      [itemId],
    );
    const item = itemResult.rows[0];
    if (!item) throw new Error("Inventory item was not found.");
    await assertInventoryPeriodOpen(client, item.branch_id, new Date());
    const baseUnit = String(item.base_unit) as InventoryBaseUnit;
    const unit = enteredUnit ?? baseUnit;
    const factor = unitFactorToBase(baseUnit, unit, conversionInput as number | string | null);
    const delta = roundQuantity(enteredQuantity * factor);
    if (delta === 0) throw new Error("Adjustment is too small for the stock precision.");
    const beforeQty = Number(item.current_qty);
    const afterQty = roundQuantity(beforeQty + delta);
    const fifo =
      delta < 0
        ? await reserveFifoConsumption(client, {
            branchId: item.branch_id,
            itemId,
            quantity: Math.abs(delta),
            fallbackUnitCost: Number(item.average_cost || 0),
          })
        : null;
    const unitCost = fifo ? fifo.unitCost : Number(item.average_cost || 0);
    const movementResult = await client.query(
      `insert into inventory_movements
         (branch_id, inventory_item_id, movement_type, reason, quantity_delta,
          before_qty, after_qty, unit_cost, entered_quantity, entered_unit, conversion_factor,
          actor_id, note)
       values ($1, $2, $3::inventory_movement_type, $4::inventory_adjustment_reason,
               $5, $6, $7, $8, $9, $10, $11, $12, $13)
       returning id`,
      [
        item.branch_id,
        itemId,
        movementType,
        reason,
        baseQuantityString(delta),
        baseQuantityString(beforeQty),
        baseQuantityString(afterQty),
        unitCost.toFixed(6),
        enteredQuantity,
        unit,
        factor,
        actorId,
        note,
      ],
    );
    const movementId = String(movementResult.rows[0].id);
    if (fifo) {
      await insertFifoConsumptionRows(client, {
        branchId: item.branch_id,
        itemId,
        movementId,
        rows: fifo.rows,
      });
    } else if (delta > 0) {
      await createInventoryCostLayer(client, {
        branchId: item.branch_id,
        itemId,
        sourceMovementId: movementId,
        quantity: delta,
        unitCost,
      });
    }
    await client.query(
      "update inventory_items set current_qty = $2, updated_at = now() where id = $1",
      [itemId, baseQuantityString(afterQty)],
    );
    await client.query(
      `insert into audit_log
         (restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
       values ($1, $2, $3, 'inventory', $4, 'adjusted',
               jsonb_build_object('delta', $5::numeric, 'entered_quantity', $6::numeric, 'unit', $7::text, 'reason', $8::text))`,
      [
        item.restaurant_id,
        item.branch_id,
        actorId,
        itemId,
        baseQuantityString(delta),
        enteredQuantity,
        unit,
        reason,
      ],
    );
    await client.query("commit");
    return [{ movement_id: movementResult.rows[0].id, new_quantity: afterQty }];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function applyInventoryCount(args: Record<string, unknown>, actorId: string) {
  const branchId = String(args._branch ?? "");
  const countDate = nullableText(args._count_date) ?? new Date().toISOString().slice(0, 10);
  const notes = nullableText(args._notes);
  const lines = Array.isArray(args._lines) ? (args._lines as Array<Record<string, unknown>>) : [];
  if (!branchId || !lines.length) throw new Error("Physical count needs at least one line.");

  const client = await pgPool.connect();
  try {
    await client.query("begin");
    await assertInventoryPeriodOpen(client, branchId, countDate);
    const countResult = await client.query(
      `insert into inventory_counts
         (branch_id, count_date, status, notes, created_by, applied_by, applied_at)
       values ($1, $2, 'applied', $3, $4, $4, now())
       returning id`,
      [branchId, countDate, notes, actorId],
    );
    const countId = String(countResult.rows[0].id);
    let adjustedLines = 0;

    for (const line of lines) {
      const itemId = String(line.inventory_item_id ?? "");
      const countedQuantity = Number(line.counted_quantity ?? 0);
      const countedUnit = String(line.counted_unit ?? "");
      const conversionInput = line.conversion_factor ?? null;
      if (!itemId || !Number.isFinite(countedQuantity) || countedQuantity < 0 || !countedUnit) {
        throw new Error("Every count line needs an ingredient, quantity, and unit.");
      }

      const itemResult = await client.query(
        `select id, branch_id, base_unit, current_qty, average_cost
         from inventory_items
         where id = $1 and branch_id = $2 and is_active = true
         for update`,
        [itemId, branchId],
      );
      const item = itemResult.rows[0];
      if (!item) throw new Error("Inventory item was not found in this branch.");
      const factor = unitFactorToBase(
        String(item.base_unit) as InventoryBaseUnit,
        countedUnit,
        conversionInput as number | string | null,
      );
      const countedBaseQty = roundQuantity(countedQuantity * factor);
      const systemQty = Number(item.current_qty);
      const varianceQty = roundQuantity(countedBaseQty - systemQty);
      const unitCost = Number(item.average_cost || 0);
      let adjustmentMovementId: string | null = null;
      let varianceUnitCost = unitCost;

      if (varianceQty !== 0) {
        const fifo =
          varianceQty < 0
            ? await reserveFifoConsumption(client, {
                branchId,
                itemId,
                quantity: Math.abs(varianceQty),
                fallbackUnitCost: unitCost,
              })
            : null;
        varianceUnitCost = fifo ? fifo.unitCost : unitCost;
        const movementResult = await client.query(
          `insert into inventory_movements
             (branch_id, inventory_item_id, movement_type, reason, quantity_delta,
              before_qty, after_qty, unit_cost, entered_quantity, entered_unit, conversion_factor,
              actor_id, note)
           values ($1, $2, 'correction', 'correction', $3, $4, $5, $6, $7, $8, $9, $10, $11)
           returning id`,
          [
            branchId,
            itemId,
            baseQuantityString(varianceQty),
            baseQuantityString(systemQty),
            baseQuantityString(countedBaseQty),
            varianceUnitCost.toFixed(6),
            countedQuantity,
            countedUnit,
            factor,
            actorId,
            notes ?? `Physical count ${countDate}`,
          ],
        );
        adjustmentMovementId = String(movementResult.rows[0].id);
        if (fifo) {
          await insertFifoConsumptionRows(client, {
            branchId,
            itemId,
            movementId: adjustmentMovementId,
            rows: fifo.rows,
          });
        } else if (varianceQty > 0) {
          await createInventoryCostLayer(client, {
            branchId,
            itemId,
            sourceMovementId: adjustmentMovementId,
            quantity: varianceQty,
            unitCost: varianceUnitCost,
          });
        }
        await client.query(
          "update inventory_items set current_qty = $2, updated_at = now() where id = $1",
          [itemId, baseQuantityString(countedBaseQty)],
        );
        adjustedLines += 1;
      }

      await client.query(
        `insert into inventory_count_lines
           (count_id, inventory_item_id, system_qty, counted_quantity, counted_unit,
            conversion_factor, counted_base_qty, variance_qty, unit_cost, variance_value,
            adjustment_movement_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          countId,
          itemId,
          baseQuantityString(systemQty),
          countedQuantity,
          countedUnit,
          factor,
          baseQuantityString(countedBaseQty),
          baseQuantityString(varianceQty),
          varianceUnitCost.toFixed(6),
          moneyString(Math.abs(varianceQty) * varianceUnitCost),
          adjustmentMovementId,
        ],
      );
    }

    await client.query("commit");
    return [{ count_id: countId, adjusted_lines: adjustedLines }];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function recordSupplierPayment(args: Record<string, unknown>, actorId: string) {
  const branchId = String(args._branch ?? "");
  const supplierId = String(args._supplier ?? "");
  const amount = Number(args._amount ?? 0);
  const financeAccountId = nullableText(args._finance_account);
  const occurredOn = nullableText(args._date) ?? new Date().toISOString().slice(0, 10);
  const reference = nullableText(args._reference);
  const notes = nullableText(args._notes);
  if (!branchId || !supplierId || !Number.isFinite(amount) || amount <= 0) {
    throw new Error("Supplier payment needs supplier, branch, and positive amount.");
  }
  if (!financeAccountId) throw new Error("Select where this supplier payment was paid from.");

  const client = await pgPool.connect();
  try {
    await client.query("begin");
    const branchResult = await client.query(
      "select id, restaurant_id from branches where id = $1",
      [branchId],
    );
    const branch = branchResult.rows[0];
    if (!branch) throw new Error("Branch was not found.");
    const supplier = await client.query(
      "select id from suppliers where id = $1 and restaurant_id = $2 and is_active = true",
      [supplierId, branch.restaurant_id],
    );
    if (!supplier.rowCount) throw new Error("Supplier was not found.");
    const source = await client.query(
      "select id from finance_accounts where id = $1 and branch_id = $2 and is_active = true",
      [financeAccountId, branchId],
    );
    if (!source.rowCount) throw new Error("Payment source is not available for this branch.");

    const result = await client.query(
      `insert into supplier_ledger_entries
         (restaurant_id, branch_id, supplier_id, entry_type, finance_account_id, amount, reference_no,
          occurred_on, notes, created_by)
       values ($1, $2, $3, 'payment', $4, $5, $6, $7, $8, $9)
       returning id`,
      [
        branch.restaurant_id,
        branchId,
        supplierId,
        financeAccountId,
        moneyString(-amount),
        reference,
        occurredOn,
        notes,
        actorId,
      ],
    );
    await client.query("commit");
    return [{ ledger_entry_id: result.rows[0].id }];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function setInventoryLock(args: Record<string, unknown>, actorId: string) {
  const branchId = String(args._branch ?? "");
  const lockedBefore = nullableText(args._locked_before);
  if (!branchId) throw new Error("Branch is required.");
  const result = await pgPool.query(
    `update branches b
     set inventory_locked_before = $2,
         updated_at = now()
     where b.id = $1
       and exists (
         select 1 from user_roles ur
         where ur.user_id = $3
           and ur.restaurant_id = b.restaurant_id
           and (ur.branch_id is null or ur.branch_id = b.id)
       )
     returning inventory_locked_before`,
    [branchId, lockedBefore, actorId],
  );
  if (!result.rowCount) throw new Error("Branch was not found or you do not have access.");
  return { data: { lockedBefore: result.rows[0].inventory_locked_before } };
}

async function setFinanceCutover(args: Record<string, unknown>, actorId: string) {
  const branchId = String(args._branch ?? "");
  const cutoverAt = nullableText(args._cutover_at);
  if (!branchId) throw new Error("Branch is required.");

  const result = await pgPool.query(
    `update branches b
     set finance_cutover_at = $2,
         updated_at = now()
     where b.id = $1
       and exists (
         select 1 from user_roles ur
         where ur.user_id = $3
           and ur.restaurant_id = b.restaurant_id
           and (ur.branch_id is null or ur.branch_id = b.id)
       )
     returning finance_cutover_at`,
    [branchId, cutoverAt, actorId],
  );
  if (!result.rowCount) throw new Error("Branch was not found or you do not have access.");
  return { data: { cutoverAt: result.rows[0].finance_cutover_at } };
}

async function getMenuItemStockStatus(args: Record<string, unknown>) {
  const branchId = String(args._branch ?? "");
  if (!branchId) throw new Error("Branch is required.");
  const result = await pgPool.query(
    `
    select
      mi.id as item_id,
      count(ir.id)::int = 0 as missing_recipe,
      bool_or(ii.current_qty < 0) as is_negative,
      bool_or(ii.current_qty <= ii.reorder_level) as is_low,
      case
        when count(ir.id) = 0 then null
        else floor(min(case when ir.quantity::numeric > 0 then ii.current_qty::numeric / ir.quantity::numeric else null end))
      end as max_possible_qty
    from menu_items mi
    left join inventory_recipes ir on ir.menu_item_id = mi.id
    left join inventory_items ii on ii.id = ir.inventory_item_id
    where mi.branch_id = $1
    group by mi.id
    `,
    [branchId],
  );
  return result.rows;
}

async function createPosOrder(args: Record<string, unknown>, actorId: string) {
  const client = await pgPool.connect();
  try {
    await client.query("begin");
    const branchId = String(args._branch ?? "");
    const branch = await getBranchForOrder(client, branchId);
    const order = await writePosOrder(client, {
      branch,
      actorId,
      diningType: String(args._dining_type ?? "dine_in"),
      customerId: nullableText(args._customer_id),
      customerName: nullableText(args._customer_name),
      customerPhone: nullableText(args._customer_phone),
      tableLabel: nullableText(args._table_label),
      orderNotes: nullableText(args._notes),
      discount: Number(args._discount ?? 0),
      couponCode: nullableText(args._coupon_code),
      items: normalizeOrderItems(args._items),
      idempotencyKey: nullableText(args._idempotency_key),
    });
    await client.query("commit");
    return [{ order_id: order.id, order_no: order.order_no }];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function updatePosOrder(args: Record<string, unknown>, actorId: string) {
  const client = await pgPool.connect();
  try {
    await client.query("begin");
    const orderId = String(args._order_id ?? "");
    const existing = await client.query("select * from orders where id = $1 for update", [orderId]);
    const previousOrder = existing.rows[0];
    if (!previousOrder) throw new Error("Order was not found.");
    if (Number(previousOrder.amount_paid ?? 0) > 0)
      throw new Error("Paid orders cannot be edited.");
    await assertInventoryPeriodOpen(client, previousOrder.branch_id, previousOrder.created_at);
    await restoreOrderInventory(
      client,
      orderId,
      actorId,
      "Order edited - previous recipe restored",
    );
    await client.query("delete from order_taxes where order_id = $1", [orderId]);
    await client.query("delete from order_items where order_id = $1", [orderId]);
    await client.query("delete from coupon_redemptions where order_id = $1", [orderId]);
    const previousCustomerId = previousOrder.customer_id ? String(previousOrder.customer_id) : null;
    const branch = await getBranchForOrder(client, previousOrder.branch_id);
    const order = await writePosOrder(client, {
      orderId,
      orderNo: previousOrder.order_no,
      branch,
      actorId,
      diningType: String(args._dining_type ?? previousOrder.dining_type),
      customerId: nullableText(args._customer_id),
      customerName: nullableText(args._customer_name),
      customerPhone: nullableText(args._customer_phone),
      tableLabel: nullableText(args._table_label),
      orderNotes: nullableText(args._notes),
      discount: Number(args._discount ?? 0),
      couponCode: nullableText(args._coupon_code),
      items: normalizeOrderItems(args._items),
      idempotencyKey: previousOrder.idempotency_key,
    });
    if (previousCustomerId) await recalculateCustomerStats(previousCustomerId, client);
    if (order.customer_id) await recalculateCustomerStats(String(order.customer_id), client);
    await client.query("commit");
    return [{ updated_order_id: order.id, order_no: order.order_no }];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function writePosOrder(
  client: PoolClient,
  input: {
    orderId?: string;
    orderNo?: string;
    branch: {
      id: string;
      code: string;
      restaurant_id: string;
      delivery_fee: number | string | null;
    };
    actorId: string;
    diningType: string;
    customerId: string | null;
    customerName: string | null;
    customerPhone: string | null;
    tableLabel: string | null;
    orderNotes: string | null;
    discount: number;
    couponCode: string | null;
    items: Array<{ item_id: string; qty: number; notes: string | null }>;
    idempotencyKey: string | null;
  },
) {
  if (!input.items.length) throw new Error("Cart is empty.");
  const itemIds = [...new Set(input.items.map((item) => item.item_id))];
  const menuResult = await client.query(
    `select * from menu_items where branch_id = $1 and id = any($2::uuid[]) and is_available = true`,
    [input.branch.id, itemIds],
  );
  const byId = new Map(menuResult.rows.map((item) => [item.id, item]));
  let subtotal = 0;
  for (const line of input.items) {
    const item = byId.get(line.item_id);
    if (!item) throw new Error("One or more menu items are unavailable.");
    subtotal += Number(item.base_price) * line.qty;
  }
  const manualDiscount = Math.max(0, Math.min(subtotal, input.discount || 0));
  const orderNo =
    input.orderNo ?? (await reserveOrderNo(client, input.branch.id, input.branch.code));
  const customer = await findOrCreateOrderCustomer(client, {
    restaurantId: input.branch.restaurant_id,
    branchId: input.branch.id,
    customerId: input.customerId,
    name: input.customerName,
    phone: input.customerPhone,
    notes: input.orderNotes,
  });
  if (customer?.is_blocked) {
    throw new Error(
      "This customer is blocked. Please review the customer profile before taking an order.",
    );
  }
  const deliveryFee =
    input.diningType === "delivery" ? roundMoney(Number(input.branch.delivery_fee ?? 0)) : 0;
  const coupon = await validateCoupon(client, {
    restaurantId: input.branch.restaurant_id,
    branchId: input.branch.id,
    code: input.couponCode,
    subtotal,
    deliveryFee,
    customerId: customer?.id ?? null,
    source: "pos",
  });
  const couponItemDiscount =
    coupon?.discountType === "free_delivery" ? 0 : (coupon?.discountAmount ?? 0);
  const deliveryDiscount =
    coupon?.discountType === "free_delivery" ? (coupon?.discountAmount ?? 0) : 0;
  const discount = roundMoney(
    Math.max(0, Math.min(subtotal, manualDiscount + couponItemDiscount)) + deliveryDiscount,
  );
  const taxableBase = Math.max(
    0,
    subtotal - Math.max(0, Math.min(subtotal, manualDiscount + couponItemDiscount)),
  );
  const taxes = await client.query(
    `select * from taxes where restaurant_id = $1 and is_active = true and apply_by_default = true`,
    [input.branch.restaurant_id],
  );
  const taxRows = taxes.rows.map((tax) => {
    const rate = Number(tax.rate);
    const amount = tax.is_inclusive
      ? roundMoney(taxableBase - taxableBase / (1 + rate / 100))
      : roundMoney((taxableBase * rate) / 100);
    return { ...tax, rate, amount };
  });
  const taxTotal = taxRows
    .filter((tax) => !tax.is_inclusive)
    .reduce((sum, tax) => sum + tax.amount, 0);
  const grandTotal = roundMoney(taxableBase + taxTotal + deliveryFee - deliveryDiscount);
  const orderResult = input.orderId
    ? await client.query(
        `update orders
         set dining_type = $2::dining_type, status = 'placed', customer_name = $3, customer_phone = $4,
             table_label = $5, notes = $6, subtotal = $7, discount_total = $8, tax_total = $9, delivery_fee = $10, grand_total = $11,
             customer_id = $12, coupon_id = $13, amount_paid = 0, payment_status = 'pending', updated_at = now()
         where id = $1 returning *`,
        [
          input.orderId,
          input.diningType,
          input.customerName,
          input.customerPhone,
          input.tableLabel,
          input.orderNotes,
          moneyString(subtotal),
          moneyString(discount),
          moneyString(taxTotal),
          moneyString(deliveryFee),
          moneyString(grandTotal),
          customer?.id ?? null,
          coupon?.id ?? null,
        ],
      )
    : await client.query(
        `insert into orders
         (branch_id, order_no, dining_type, status, payment_status, customer_id, customer_name, customer_phone, table_label, notes,
          subtotal, discount_total, tax_total, delivery_fee, grand_total, amount_paid, coupon_id, idempotency_key, created_by)
         values ($1, $2, $3::dining_type, 'placed', 'pending', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 0, $14, $15, $16)
         returning *`,
        [
          input.branch.id,
          orderNo,
          input.diningType,
          customer?.id ?? null,
          input.customerName,
          input.customerPhone,
          input.tableLabel,
          input.orderNotes,
          moneyString(subtotal),
          moneyString(discount),
          moneyString(taxTotal),
          moneyString(deliveryFee),
          moneyString(grandTotal),
          coupon?.id ?? null,
          input.idempotencyKey,
          input.actorId,
        ],
      );
  const order = orderResult.rows[0];
  if (customer && !input.orderId) {
    await recordCustomerOrder(client, {
      customerId: customer.id,
      restaurantId: input.branch.restaurant_id,
      branchId: input.branch.id,
      orderId: order.id,
      orderNo: order.order_no,
      grandTotal,
    });
  }
  if (coupon) {
    await recordCouponRedemption(client, {
      coupon,
      orderId: order.id,
      customerId: customer?.id ?? null,
      restaurantId: input.branch.restaurant_id,
      branchId: input.branch.id,
    });
  }
  for (const line of input.items) {
    const item = byId.get(line.item_id);
    const lineSubtotal = roundMoney(Number(item.base_price) * line.qty);
    await client.query(
      `insert into order_items (order_id, item_id, name_snapshot, unit_price, qty, addons_total, line_subtotal, notes)
       values ($1, $2, $3, $4, $5, 0, $6, $7)`,
      [
        order.id,
        item.id,
        item.name,
        item.base_price,
        line.qty,
        moneyString(lineSubtotal),
        line.notes,
      ],
    );
  }
  await deductOrderInventory(client, {
    orderId: order.id,
    branchId: input.branch.id,
    actorId: input.actorId,
    orderNo: order.order_no,
  });
  for (const tax of taxRows) {
    await client.query(
      `insert into order_taxes (order_id, tax_id, name_snapshot, rate_snapshot, amount)
       values ($1, $2, $3, $4, $5)`,
      [order.id, tax.id, tax.name, tax.rate.toFixed(3), moneyString(tax.amount)],
    );
  }
  return order;
}

export async function deductOrderInventoryForOrderTx(
  client: PoolClient,
  input: { orderId: string; branchId: string; actorId: string | null; orderNo: string },
) {
  await deductOrderInventory(client, input);
}

async function deductOrderInventory(
  client: PoolClient,
  input: { orderId: string; branchId: string; actorId: string | null; orderNo: string },
) {
  const usage = await client.query(
    `select ir.inventory_item_id, sum(ir.quantity::numeric * oi.qty::numeric) as quantity
     from order_items oi
     join inventory_recipes ir on ir.menu_item_id = oi.item_id
     where oi.order_id = $1
     group by ir.inventory_item_id
     order by ir.inventory_item_id`,
    [input.orderId],
  );

  for (const row of usage.rows) {
    const quantity = roundQuantity(Number(row.quantity));
    if (quantity <= 0) continue;
    const itemResult = await client.query(
      `select id, branch_id, base_unit, current_qty, average_cost
       from inventory_items where id = $1 for update`,
      [row.inventory_item_id],
    );
    const item = itemResult.rows[0];
    if (!item) throw new Error("A recipe ingredient no longer exists.");
    if (String(item.branch_id) !== input.branchId) {
      throw new Error("A recipe uses an ingredient from another branch.");
    }
    const beforeQty = Number(item.current_qty);
    const afterQty = roundQuantity(beforeQty - quantity);
    const fifo = await reserveFifoConsumption(client, {
      branchId: input.branchId,
      itemId: item.id,
      quantity,
      fallbackUnitCost: Number(item.average_cost || 0),
    });
    await client.query(
      "update inventory_items set current_qty = $2, updated_at = now() where id = $1",
      [item.id, baseQuantityString(afterQty)],
    );
    const movementResult = await client.query(
      `insert into inventory_movements
         (branch_id, inventory_item_id, movement_type, reason, quantity_delta,
          before_qty, after_qty, unit_cost, entered_quantity, entered_unit, conversion_factor,
          related_order_id, actor_id, note)
       values ($1, $2, 'sale', 'sale', $3, $4, $5, $6, $7, $8, 1, $9, $10, $11)
       returning id`,
      [
        input.branchId,
        item.id,
        baseQuantityString(-quantity),
        baseQuantityString(beforeQty),
        baseQuantityString(afterQty),
        fifo.unitCost.toFixed(6),
        -quantity,
        item.base_unit,
        input.orderId,
        input.actorId,
        input.orderNo,
      ],
    );
    await insertFifoConsumptionRows(client, {
      branchId: input.branchId,
      itemId: item.id,
      movementId: String(movementResult.rows[0].id),
      rows: fifo.rows,
    });
  }
}

async function restoreOrderInventory(
  client: PoolClient,
  orderId: string,
  actorId: string,
  note: string,
) {
  const netUsage = await client.query(
    `select inventory_item_id, branch_id, sum(quantity_delta::numeric) as net_delta
     from inventory_movements
     where related_order_id = $1
     group by inventory_item_id, branch_id
     having sum(quantity_delta::numeric) < 0
     order by inventory_item_id`,
    [orderId],
  );
  for (const row of netUsage.rows) {
    const restoreQuantity = roundQuantity(-Number(row.net_delta));
    if (restoreQuantity <= 0) continue;
    const itemResult = await client.query(
      "select id, base_unit, current_qty, average_cost from inventory_items where id = $1 for update",
      [row.inventory_item_id],
    );
    const item = itemResult.rows[0];
    if (!item) continue;
    const beforeQty = Number(item.current_qty);
    const afterQty = roundQuantity(beforeQty + restoreQuantity);
    await client.query(
      "update inventory_items set current_qty = $2, updated_at = now() where id = $1",
      [item.id, baseQuantityString(afterQty)],
    );
    const movementResult = await client.query(
      `insert into inventory_movements
         (branch_id, inventory_item_id, movement_type, reason, quantity_delta,
          before_qty, after_qty, unit_cost, entered_quantity, entered_unit, conversion_factor,
          related_order_id, actor_id, note)
       values ($1, $2, 'correction', 'correction', $3, $4, $5, $6, $7, $8, 1, $9, $10, $11)
       returning id`,
      [
        row.branch_id,
        item.id,
        baseQuantityString(restoreQuantity),
        baseQuantityString(beforeQty),
        baseQuantityString(afterQty),
        item.average_cost,
        restoreQuantity,
        item.base_unit,
        orderId,
        actorId,
        note,
      ],
    );
    await createInventoryCostLayer(client, {
      branchId: row.branch_id,
      itemId: item.id,
      sourceMovementId: String(movementResult.rows[0].id),
      quantity: restoreQuantity,
      unitCost: Number(item.average_cost || 0),
    });
  }
}

async function findOrCreateOrderCustomer(
  client: PoolClient,
  input: {
    restaurantId: string;
    branchId: string;
    customerId?: string | null;
    name: string | null;
    phone: string | null;
    notes: string | null;
  },
) {
  const phone = input.phone?.trim();
  const phoneNormalized = normalizePhone(phone);
  const name = nullableText(input.name);
  const context = parseCustomerContext(input.notes);

  if (input.customerId) {
    const selected = await client.query<{ id: string; is_blocked: boolean }>(
      `
      update customers
      set branch_id = $3,
          name = coalesce($4, customers.name),
          primary_phone = case
            when customers.primary_phone = '' and $5 <> '' then $5
            else customers.primary_phone
          end,
          default_address = coalesce(customers.default_address, $6),
          notes = coalesce(customers.notes, $7),
          updated_at = now()
      where id = $1
        and restaurant_id = $2
      returning id, is_blocked
      `,
      [
        input.customerId,
        input.restaurantId,
        input.branchId,
        name,
        phone ?? "",
        context.address,
        context.preferenceNote,
      ],
    );
    const customer = selected.rows[0];
    if (!customer) throw new Error("Selected customer profile was not found.");

    await addCustomerAddressIfNeeded(client, customer.id, context.address);

    return customer;
  }

  const identityKey = phoneNormalized || nameIdentityKey(name);
  if (!identityKey) return null;

  if (!phoneNormalized) {
    const existingByName = await client.query<{ id: string; is_blocked: boolean }>(
      `
      update customers
      set branch_id = $2,
          name = coalesce($3, customers.name),
          default_address = coalesce(customers.default_address, $4),
          notes = coalesce(customers.notes, $5),
          updated_at = now()
      where id = (
        select c.id
        from customers c
        where c.restaurant_id = $1
          and (
            c.phone_normalized = $6
            or 'name:' || regexp_replace(
              regexp_replace(lower(trim(coalesce(c.name, ''))), '[^a-z0-9]+', '-', 'g'),
              '(^-+|-+$)',
              '',
              'g'
            ) = $6
          )
        order by c.total_orders desc, c.total_spent::numeric desc, c.updated_at desc
        limit 1
      )
      returning id, is_blocked
      `,
      [
        input.restaurantId,
        input.branchId,
        name,
        context.address,
        context.preferenceNote,
        identityKey,
      ],
    );
    const existingCustomer = existingByName.rows[0];
    if (existingCustomer) {
      await addCustomerAddressIfNeeded(client, existingCustomer.id, context.address);
      return existingCustomer;
    }
  }

  const result = await client.query(
    `insert into customers
       (restaurant_id, branch_id, name, primary_phone, phone_normalized, default_address, notes)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (restaurant_id, phone_normalized) do update
       set branch_id = excluded.branch_id,
           name = coalesce(excluded.name, customers.name),
           primary_phone = case
             when excluded.primary_phone <> '' then excluded.primary_phone
             else customers.primary_phone
           end,
           default_address = coalesce(customers.default_address, excluded.default_address),
           notes = coalesce(customers.notes, excluded.notes),
           updated_at = now()
     returning id, is_blocked`,
    [
      input.restaurantId,
      input.branchId,
      name,
      phone ?? "",
      identityKey,
      context.address,
      context.preferenceNote,
    ],
  );
  const customer = result.rows[0] as { id: string; is_blocked: boolean } | undefined;
  if (!customer) return null;

  await addCustomerAddressIfNeeded(client, customer.id, context.address);

  return customer;
}

async function addCustomerAddressIfNeeded(
  client: PoolClient,
  customerId: string,
  address: string | null,
) {
  if (!address) return;
  await client.query(
    `insert into customer_addresses (customer_id, address, is_default)
     values ($1, $2, true)
     on conflict (customer_id, address) do nothing`,
    [customerId, address],
  );
}

async function recordCustomerOrder(
  client: PoolClient,
  input: {
    customerId: string;
    restaurantId: string;
    branchId: string;
    orderId: string;
    orderNo: string;
    grandTotal: number;
  },
) {
  await client.query(
    `update customers
     set first_order_at = coalesce(first_order_at, now()),
         last_order_at = now(),
         total_orders = total_orders + 1,
         updated_at = now()
     where id = $1`,
    [input.customerId],
  );
  await client.query(
    `insert into customer_events (customer_id, restaurant_id, branch_id, order_id, event_type, meta)
     values ($1, $2, $3, $4, 'order_placed', jsonb_build_object('order_no', $5::text, 'grand_total', $6::numeric))`,
    [
      input.customerId,
      input.restaurantId,
      input.branchId,
      input.orderId,
      input.orderNo,
      moneyString(input.grandTotal),
    ],
  );
}

async function updateOrderStatus(args: Record<string, unknown>, actorId: string, status: string) {
  const orderId = String(args._order_id ?? "");
  if (!orderId) throw new Error("Order is required.");
  const allowed = new Set([
    "open",
    "placed",
    "preparing",
    "ready",
    "served",
    "completed",
    "cancelled",
  ]);
  if (!allowed.has(status)) throw new Error("Invalid order status.");
  const client = await pgPool.connect();
  try {
    await client.query("begin");
    const existing = await client.query(
      "select status, branch_id, created_at from orders where id = $1 for update",
      [orderId],
    );
    if (!existing.rowCount) throw new Error("Order was not found.");
    if (status === "cancelled" && existing.rows[0].status !== "cancelled") {
      await assertInventoryPeriodOpen(
        client,
        existing.rows[0].branch_id,
        existing.rows[0].created_at,
      );
      await restoreOrderInventory(client, orderId, actorId, "Order cancelled - recipe restored");
    }
    const result = await client.query(
      `update orders
       set status = $2::order_status,
           updated_at = now(),
           completed_at = case
             when $2 = 'completed' then coalesce(completed_at, now())
             when $2 in ('open', 'placed', 'preparing', 'ready', 'served') then null
             else completed_at
           end
       where id = $1
       returning customer_id, order_no, grand_total, payment_status`,
      [orderId, status],
    );
    if (!result.rowCount) throw new Error("Order was not found.");
    const order = result.rows[0];
    if (order.customer_id) {
      await recalculateCustomerStats(String(order.customer_id), client);
      if (status === "completed" && order.payment_status === "paid") {
        await recordLoyaltyEarnedEvent(client, {
          customerId: String(order.customer_id),
          orderId,
          orderNo: String(order.order_no),
          grandTotal: Number(order.grand_total),
        });
      }
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  await auditOrder(orderId, actorId, status, nullableText(args._reason));
  return { data: null };
}

async function setOrderCustomerPending(args: Record<string, unknown>, actorId: string) {
  const orderId = String(args._order_id ?? "");
  const isPending = args._is_pending !== false;
  const reason = nullableText(args._reason);
  if (!orderId) throw new Error("Order is required.");

  const result = await pgPool.query(
    isPending
      ? `update orders
         set is_customer_pending = true,
             updated_at = now()
         where id = $1
           and payment_status in ('pending', 'partial')
           and status not in ('cancelled', 'voided', 'refunded')
           and greatest(grand_total::numeric - coalesce(amount_paid, 0)::numeric, 0) > 0
         returning id`
      : `update orders
         set is_customer_pending = false,
             updated_at = now()
         where id = $1
         returning id`,
    [orderId],
  );
  if (!result.rowCount) {
    throw new Error("Only active unpaid orders can be added to customer pending.");
  }
  await auditOrder(
    orderId,
    actorId,
    isPending ? "customer_pending_added" : "customer_pending_removed",
    reason,
  );
  return { data: null };
}

async function deleteOrderAdmin(args: Record<string, unknown>) {
  const orderId = String(args._order_id ?? "");
  if (!orderId) throw new Error("Order is required.");
  await pgPool.query(
    "delete from orders where id = $1 and status in ('cancelled', 'voided', 'refunded')",
    [orderId],
  );
  return { data: null };
}

async function adjustOrderDiscount(args: Record<string, unknown>, actorId: string) {
  const orderId = String(args._order_id ?? "");
  const discount = Number(args._discount ?? 0);
  const client = await pgPool.connect();
  try {
    await client.query("begin");
    const existing = await client.query("select * from orders where id = $1 for update", [orderId]);
    const order = existing.rows[0];
    if (!order) throw new Error("Order was not found.");
    const subtotal = Number(order.subtotal);
    const nextDiscount = Math.max(0, Math.min(subtotal, discount));
    const taxes = await client.query("select * from order_taxes where order_id = $1", [orderId]);
    const taxTotal = taxes.rows.reduce((sum, tax) => sum + Number(tax.amount || 0), 0);
    const grandTotal = roundMoney(
      subtotal - nextDiscount + taxTotal + Number(order.delivery_fee ?? 0),
    );
    await client.query(
      `update orders
       set discount_total = $2, grand_total = $3,
           payment_status = case when amount_paid >= $3::numeric then 'paid'::payment_status when amount_paid > 0 then 'partial'::payment_status else 'pending'::payment_status end,
           updated_at = now()
       where id = $1`,
      [orderId, moneyString(nextDiscount), moneyString(grandTotal)],
    );
    await recalculateCustomerStatsForOrder(client, orderId);
    await client.query("commit");
    await auditOrder(orderId, actorId, "discount_adjusted", nullableText(args._reason));
    return { data: null };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function voidOrder(args: Record<string, unknown>, actorId: string) {
  const orderId = String(args._order_id ?? "");
  const method = String(args._method ?? "cash");
  const reference = nullableText(args._reference);
  const client = await pgPool.connect();
  try {
    await client.query("begin");
    const existing = await client.query("select * from orders where id = $1 for update", [orderId]);
    const order = existing.rows[0];
    if (!order) throw new Error("Order was not found.");
    await assertInventoryPeriodOpen(client, order.branch_id, order.created_at);
    const financeAccountId = await resolveFinanceAccountId(
      client,
      String(order.branch_id),
      method,
      args._finance_account_id,
    );
    if (Number(order.amount_paid) > 0) {
      await client.query(
        `insert into payments (order_id, method, kind, finance_account_id, amount, reference, received_by)
         values ($1, $2, 'void_adjustment', $3, $4, $5, $6)`,
        [
          orderId,
          method,
          financeAccountId,
          `-${Number(order.amount_paid).toFixed(2)}`,
          reference,
          actorId,
        ],
      );
    }
    await client.query(
      `update orders set status = 'voided', payment_status = 'refunded', amount_paid = 0, updated_at = now() where id = $1`,
      [orderId],
    );
    await restoreOrderInventory(client, orderId, actorId, "Order voided - recipe restored");
    await recalculateCustomerStatsForOrder(client, orderId);
    await client.query("commit");
    await auditOrder(orderId, actorId, "voided", nullableText(args._reason));
    return { data: null };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function refundOrder(args: Record<string, unknown>, actorId: string) {
  const orderId = String(args._order_id ?? "");
  const amount = Number(args._amount ?? 0);
  const method = String(args._method ?? "cash");
  const reference = nullableText(args._reference);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid refund amount.");
  const client = await pgPool.connect();
  try {
    await client.query("begin");
    const existing = await client.query("select * from orders where id = $1 for update", [orderId]);
    const order = existing.rows[0];
    if (!order) throw new Error("Order was not found.");
    if (amount > Number(order.amount_paid)) throw new Error("Refund exceeds paid amount.");
    const financeAccountId = await resolveFinanceAccountId(
      client,
      String(order.branch_id),
      method,
      args._finance_account_id,
    );
    await client.query(
      `insert into payments (order_id, method, kind, finance_account_id, amount, reference, received_by)
       values ($1, $2, 'refund', $3, $4, $5, $6)`,
      [orderId, method, financeAccountId, `-${amount.toFixed(2)}`, reference, actorId],
    );
    const nextPaid = Math.max(0, Number(order.amount_paid) - amount);
    await client.query(
      `update orders
       set amount_paid = $2,
           payment_status = case when $2::numeric <= 0 then 'refunded'::payment_status when $2::numeric < grand_total then 'partial'::payment_status else 'paid'::payment_status end,
           status = case when $2::numeric <= 0 then 'refunded'::order_status else status end,
           updated_at = now()
       where id = $1`,
      [orderId, moneyString(nextPaid)],
    );
    if (nextPaid <= 0 && args._restore_inventory === true) {
      await assertInventoryPeriodOpen(client, order.branch_id, order.created_at);
      await restoreOrderInventory(client, orderId, actorId, "Full refund - recipe restored");
    }
    await recalculateCustomerStatsForOrder(client, orderId);
    await client.query("commit");
    await auditOrder(orderId, actorId, "refunded", nullableText(args._reason));
    return { data: null };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function getBranchForOrder(client: PoolClient, branchId: string) {
  const result = await client.query(
    "select id, code, restaurant_id, delivery_fee from branches where id = $1",
    [branchId],
  );
  const branch = result.rows[0];
  if (!branch) throw new Error("Branch was not found.");
  return branch;
}

async function reserveOrderNo(client: PoolClient, branchId: string, branchCode: string) {
  const today = new Date().toISOString().slice(0, 10);
  const result = await client.query(
    `insert into order_counters (branch_id, counter_date, last_seq)
     values ($1, $2, 1)
     on conflict (branch_id, counter_date) do update set last_seq = order_counters.last_seq + 1
     returning last_seq`,
    [branchId, today],
  );
  return `AK-${branchCode || "BR"}-${today.replaceAll("-", "")}-${String(result.rows[0].last_seq).padStart(4, "0")}`;
}

async function auditOrder(orderId: string, actorId: string, action: string, reason: string | null) {
  await pgPool.query(
    `insert into audit_log (restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
     select b.restaurant_id, o.branch_id, $2, 'order', o.id, $3, jsonb_build_object('reason', $4::text)
     from orders o join branches b on b.id = o.branch_id where o.id = $1`,
    [orderId, actorId, action, reason],
  );
}

async function recalculateCustomerStatsForOrder(client: PoolClient, orderId: string) {
  const result = await client.query("select customer_id from orders where id = $1", [orderId]);
  const customerId = result.rows[0]?.customer_id ? String(result.rows[0].customer_id) : null;
  if (customerId) {
    await recalculateCustomerStats(customerId, client);
  }
}

async function recordLoyaltyEarnedEvent(
  client: PoolClient,
  input: {
    customerId: string;
    orderId: string;
    orderNo: string;
    grandTotal: number;
  },
) {
  const points = Math.floor(Math.max(0, input.grandTotal) / 100);
  await client.query(
    `
    insert into customer_events (customer_id, restaurant_id, branch_id, order_id, event_type, meta)
    select
      o.customer_id,
      b.restaurant_id,
      o.branch_id,
      o.id,
      'loyalty_earned',
      jsonb_build_object('order_no', $3::text, 'grand_total', $4::numeric, 'points', $5::int)
    from orders o
    join branches b on b.id = o.branch_id
    where o.id = $2
      and o.customer_id = $1
      and not exists (
        select 1
        from customer_events ce
        where ce.customer_id = $1
          and ce.order_id = $2
          and ce.event_type = 'loyalty_earned'
      )
    `,
    [input.customerId, input.orderId, input.orderNo, moneyString(input.grandTotal), points],
  );
}

function normalizeOrderItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const raw = item as Record<string, unknown>;
    return {
      item_id: String(raw.item_id ?? raw.itemId ?? ""),
      qty: Number(raw.qty ?? 0),
      notes: nullableText(raw.notes),
    };
  });
}

function nullableText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function normalizePhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("0")) return `92${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("3")) return `92${digits}`;
  return digits;
}

function nameIdentityKey(value: string | null) {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized ? `name:${normalized}` : "";
}

function parseCustomerContext(notes: string | null | undefined) {
  const raw = notes?.trim();
  if (!raw) return { address: null, preferenceNote: null };

  const lines = raw.split(/\r?\n/);
  const addressLine = lines.find((line) => /^(delivery address|address):/i.test(line));
  const address = addressLine?.replace(/^(delivery address|address):\s*/i, "").trim() || null;
  const preferenceNote =
    lines
      .filter((line) => !/^(delivery address|address):/i.test(line))
      .join("\n")
      .trim() || null;

  return { address, preferenceNote };
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function moneyString(value: number) {
  return roundMoney(value).toFixed(2);
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function baseQuantityString(value: number) {
  return roundQuantity(value).toFixed(3);
}

function buildWhere(filters: Array<z.infer<typeof FilterSchema>>, offset: number) {
  const params: unknown[] = [];
  if (!filters.length) return { where: "", params };
  const parts = filters.map((filter) => {
    assertIdentifier(filter.column);
    if (filter.op === "in") {
      const values = Array.isArray(filter.value) ? filter.value : [];
      if (!values.length) return "false";
      const placeholders = values.map((value) => {
        params.push(normalizeValue(value));
        return `$${offset + params.length}`;
      });
      return `${ident(filter.column)} in (${placeholders.join(", ")})`;
    }
    params.push(normalizeValue(filter.value));
    const placeholder = `$${offset + params.length}`;
    const opMap = { eq: "=", neq: "<>", gte: ">=", lte: "<=", lt: "<", gt: ">" } as const;
    const op = opMap[filter.op as keyof typeof opMap];
    return `${ident(filter.column)} ${op} ${placeholder}`;
  });
  return { where: ` where ${parts.join(" and ")}`, params };
}

function buildOrder(orders: Array<z.infer<typeof OrderSchema>>) {
  if (!orders.length) return "";
  return ` order by ${orders
    .map((order) => {
      assertIdentifier(order.column);
      return `${ident(order.column)} ${order.ascending ? "asc" : "desc"}`;
    })
    .join(", ")}`;
}

function normalizeSelectColumns(columns: string) {
  if (!columns || columns.trim() === "*" || columns.includes("(")) return "*";
  return columns
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean)
    .map(ident)
    .join(", ");
}

async function attachExpenseCategories(rows: Record<string, unknown>[]) {
  const categoryIds = [...new Set(rows.map((row) => row.category_id).filter(Boolean))] as string[];
  if (!categoryIds.length) {
    return rows.map((row) => ({ ...row, operational_expense_categories: null }));
  }
  const result = await pgPool.query(
    `select id, name from operational_expense_categories where id in (${categoryIds.map((_, index) => `$${index + 1}`).join(", ")})`,
    categoryIds,
  );
  const byId = new Map(result.rows.map((row) => [row.id, { name: row.name }]));
  return rows.map((row) => ({
    ...row,
    operational_expense_categories: row.category_id
      ? (byId.get(row.category_id as string) ?? null)
      : null,
  }));
}

function normalizeValue(value: unknown) {
  if (value === undefined) return null;
  return value;
}

function requireAuthContext(context: unknown): { userId: string } {
  if (!context || typeof context !== "object" || !("userId" in context)) {
    throw new Response("Unauthorized", { status: 401 });
  }

  return context as { userId: string };
}

async function assertTableAccess(userId: string, table: string, operation: DataOperation) {
  assertTable(table);
  const policy = TABLE_POLICIES[table];
  if (!policy) {
    throw new AuthorizationError("No access policy exists for this table.");
  }

  const permissions = operation === "read" ? policy.read : (policy[operation] ?? policy.write);
  if (!permissions?.length) {
    throw new AuthorizationError();
  }

  await assertUserPermissions(userId, permissions);
}

async function assertRpcAccess(userId: string, fn: string) {
  const permissions = RPC_POLICIES[fn];
  if (!permissions?.length) {
    throw new AuthorizationError("No access policy exists for this action.");
  }

  await assertUserPermissions(userId, permissions);
}

async function assertUserPermissions(userId: string, permissions: readonly AppPermission[]) {
  const roles = await getUserRoles(userId);
  if (!hasAnyPermission(roles, permissions)) {
    throw new AuthorizationError();
  }
}

function assertTable(table: string) {
  if (!TABLES.has(table))
    throw new Error(`Table is not available through PostgreSQL data client: ${table}`);
}

function assertWritableTable(table: string) {
  assertTable(table);
  if (table.startsWith("inventory_") && table.endsWith("_stock"))
    throw new Error("View is read-only.");
  if (
    table === "inventory_food_cost_by_menu_item" ||
    table === "inventory_low_stock" ||
    table === "inventory_menu_performance" ||
    table === "inventory_cost_layers" ||
    table === "inventory_fifo_consumptions" ||
    table === "supplier_ledger_entries"
  ) {
    throw new Error("View is read-only.");
  }
}

function ident(value: string) {
  assertIdentifier(value);
  return `"${value}"`;
}

function assertIdentifier(value: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(`Invalid SQL identifier: ${value}`);
  }
}
