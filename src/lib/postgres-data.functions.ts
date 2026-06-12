import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pgPool } from "@/db/client.server";
import { requirePostgresAuth } from "@/integrations/postgres/auth-middleware";
import { AuthorizationError, getUserRoles } from "@/services/authorization.service.server";
import { recalculateCustomerStats } from "@/services/customer-stats.service.server";
import { recordCouponRedemption, validateCoupon } from "@/services/coupon.service.server";
import { hasAnyPermission, type AppPermission } from "@/lib/rbac";

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
  "customers",
  "customer_addresses",
  "customer_events",
  "coupon_campaigns",
  "coupon_redemptions",
  "homepage_promotions",
  "customer_reviews",
  "product_analytics_events",
  "profiles",
  "user_roles",
  "inventory_items",
  "inventory_movements",
  "inventory_purchases",
  "inventory_purchase_lines",
  "inventory_recipes",
  "suppliers",
  "operational_expenses",
  "operational_expense_categories",
  "branch_printer_settings",
  "inventory_low_stock",
  "inventory_food_cost_by_menu_item",
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
  inventory_recipes: {
    read: ["inventory:view", "menu:manage"],
    write: ["inventory:manage"],
    delete: ["inventory:manage"],
  },
  suppliers: {
    read: ["inventory:view"],
    write: ["inventory:manage"],
    delete: ["inventory:manage"],
  },
  inventory_low_stock: { read: ["dashboard:view", "inventory:view"] },
  inventory_food_cost_by_menu_item: { read: ["inventory:view", "menu:manage"] },

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
  recalculate_customer_stats: ["customers:manage"],
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

async function selectVirtualRows(baseSql: string, input: z.infer<typeof SelectSchema>) {
  const params: unknown[] = [];
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

async function runInsert(input: z.infer<typeof InsertSchema>) {
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
  const sql = `insert into ${ident(input.table)} (${columns.map(ident).join(", ")}) values ${valuesSql}${input.returning ? " returning *" : ""}`;
  const result = await pgPool.query(sql, params);
  return { data: input.returning ? result.rows : null };
}

async function runUpdate(input: z.infer<typeof UpdateSchema>) {
  if (!input.filters.length) throw new Error("Refusing to update without a filter.");
  const params: unknown[] = [];
  const setSql = Object.entries(input.values)
    .map(([column, value]) => {
      params.push(normalizeValue(value));
      return `${ident(column)} = $${params.length}`;
    })
    .join(", ");
  const { where, params: filterParams } = buildWhere(input.filters, params.length);
  params.push(...filterParams);
  const result = await pgPool.query(
    `update ${ident(input.table)} set ${setSql}${where}${input.returning ? " returning *" : ""}`,
    params,
  );
  return { data: input.returning ? result.rows : null };
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
    case "recalculate_customer_stats":
      return recalculateCustomerStats(String(args._customer_id ?? ""));
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

async function recordPayment(args: Record<string, unknown>, actorId: string) {
  const client = await pgPool.connect();
  const orderId = String(args._order_id ?? "");
  const method = String(args._method ?? "cash");
  const amount = Number(args._amount ?? 0);
  const reference = args._reference ? String(args._reference) : null;
  if (!orderId || !Number.isFinite(amount) || amount <= 0) throw new Error("Invalid payment.");

  await client.query("begin");
  try {
    await client.query(
      `insert into payments (order_id, method, kind, amount, reference, received_by)
       values ($1, $2, 'payment', $3, $4, $5)`,
      [orderId, method, amount.toFixed(2), reference, actorId],
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
    branch: { id: string; code: string; restaurant_id: string; delivery_fee: number | string | null };
    actorId: string;
    diningType: string;
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
    name: input.customerName,
    phone: input.customerPhone,
    notes: input.orderNotes,
  });
  if (customer?.is_blocked) {
    throw new Error("This customer is blocked. Please review the customer profile before taking an order.");
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
  const couponItemDiscount = coupon?.discountType === "free_delivery" ? 0 : (coupon?.discountAmount ?? 0);
  const deliveryDiscount = coupon?.discountType === "free_delivery" ? (coupon?.discountAmount ?? 0) : 0;
  const discount = roundMoney(Math.max(0, Math.min(subtotal, manualDiscount + couponItemDiscount)) + deliveryDiscount);
  const taxableBase = Math.max(0, subtotal - Math.max(0, Math.min(subtotal, manualDiscount + couponItemDiscount)));
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
  for (const tax of taxRows) {
    await client.query(
      `insert into order_taxes (order_id, tax_id, name_snapshot, rate_snapshot, amount)
       values ($1, $2, $3, $4, $5)`,
      [order.id, tax.id, tax.name, tax.rate.toFixed(3), moneyString(tax.amount)],
    );
  }
  return order;
}

async function findOrCreateOrderCustomer(
  client: PoolClient,
  input: {
    restaurantId: string;
    branchId: string;
    name: string | null;
    phone: string | null;
    notes: string | null;
  },
) {
  const phone = input.phone?.trim();
  const phoneNormalized = normalizePhone(phone);
  if (!phone || !phoneNormalized) return null;

  const context = parseCustomerContext(input.notes);
  const result = await client.query(
    `insert into customers
       (restaurant_id, branch_id, name, primary_phone, phone_normalized, default_address, notes)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (restaurant_id, phone_normalized) do update
       set branch_id = excluded.branch_id,
           name = coalesce(excluded.name, customers.name),
           primary_phone = excluded.primary_phone,
           default_address = coalesce(customers.default_address, excluded.default_address),
           notes = coalesce(customers.notes, excluded.notes),
           updated_at = now()
     returning id, is_blocked`,
    [
      input.restaurantId,
      input.branchId,
      nullableText(input.name),
      phone,
      phoneNormalized,
      context.address,
      context.preferenceNote,
    ],
  );
  const customer = result.rows[0] as { id: string; is_blocked: boolean } | undefined;
  if (!customer) return null;

  if (context.address) {
    await client.query(
      `insert into customer_addresses (customer_id, address, is_default)
       values ($1, $2, true)
       on conflict (customer_id, address) do nothing`,
      [customer.id, context.address],
    );
  }

  return customer;
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
    const grandTotal = roundMoney(subtotal - nextDiscount + taxTotal + Number(order.delivery_fee ?? 0));
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
    if (Number(order.amount_paid) > 0) {
      await client.query(
        `insert into payments (order_id, method, kind, amount, reference, received_by)
         values ($1, $2, 'void_adjustment', $3, $4, $5)`,
        [orderId, method, `-${Number(order.amount_paid).toFixed(2)}`, reference, actorId],
      );
    }
    await client.query(
      `update orders set status = 'voided', payment_status = 'refunded', amount_paid = 0, updated_at = now() where id = $1`,
      [orderId],
    );
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
    await client.query(
      `insert into payments (order_id, method, kind, amount, reference, received_by)
       values ($1, $2, 'refund', $3, $4, $5)`,
      [orderId, method, `-${amount.toFixed(2)}`, reference, actorId],
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

async function getBranchForOrder(
  client: PoolClient,
  branchId: string,
) {
  const result = await client.query(
    "select id, code, restaurant_id, delivery_fee from branches where id = $1",
    [branchId],
  );
  const branch = result.rows[0];
  if (!branch) throw new Error("Branch was not found.");
  return branch;
}

async function reserveOrderNo(
  client: PoolClient,
  branchId: string,
  branchCode: string,
) {
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
    [
      input.customerId,
      input.orderId,
      input.orderNo,
      moneyString(input.grandTotal),
      points,
    ],
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

  const permissions = operation === "read" ? policy.read : policy[operation] ?? policy.write;
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
  if (table === "inventory_food_cost_by_menu_item" || table === "inventory_low_stock") {
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
