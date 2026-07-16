import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pgPool } from "@/db/client.server";
import { deductOrderInventoryForOrderTx } from "@/lib/postgres-data.functions";
import {
  recordCouponRedemption,
  validateCoupon,
  type ValidCoupon,
} from "@/services/coupon.service.server";

export type CustomerOrderInput = {
  branchId: string;
  diningType: "takeaway" | "delivery";
  customerName: string;
  customerPhone?: string | null;
  notes?: string | null;
  couponCode?: string | null;
  items: Array<{
    itemId: string;
    qty: number;
    notes?: string | null;
  }>;
};

type BranchRow = {
  id: string;
  restaurant_id: string;
  code: string;
  is_active: boolean;
  delivery_fee: string | number | null;
};

type MenuItemRow = {
  id: string;
  branch_id: string;
  name: string;
  base_price: string | number;
  is_available: boolean;
};

type CustomerRow = {
  id: string;
  is_blocked: boolean;
};

export async function createCustomerOrder(input: CustomerOrderInput) {
  if (!input.items.length) {
    throw new Error("Order must contain at least one item.");
  }

  const client = await pgPool.connect();
  try {
    await client.query("begin");

    const branch = await getBranchForCustomerOrder(client, input.branchId);
    const itemById = await getAvailableMenuItems(client, branch.id, input.items);
    const subtotal = calculateSubtotal(input.items, itemById);

    const customer = await findOrCreateCustomer(client, {
      restaurantId: branch.restaurant_id,
      branchId: branch.id,
      name: input.customerName,
      phone: input.customerPhone,
      notes: input.notes,
    });
    if (customer?.is_blocked) {
      throw new Error(
        "This customer is blocked. Please review the customer profile before taking an order.",
      );
    }

    const deliveryFee =
      input.diningType === "delivery" ? roundMoney(Number(branch.delivery_fee ?? 0)) : 0;
    const coupon = await validateCoupon(client, {
      restaurantId: branch.restaurant_id,
      branchId: branch.id,
      code: input.couponCode,
      subtotal,
      deliveryFee,
      customerId: customer?.id ?? null,
      source: "website",
    });
    const totals = await calculateOrderTotals(client, {
      restaurantId: branch.restaurant_id,
      subtotal,
      deliveryFee,
      coupon,
    });
    const orderNo = await reserveNextOrderNumber(client, branch.id, branch.code);
    const orderId = randomUUID();

    await client.query(
      `insert into orders
         (id, branch_id, order_no, dining_type, status, payment_status, customer_id,
          customer_name, customer_phone, notes, subtotal, discount_total, tax_total,
          delivery_fee, grand_total, amount_paid, coupon_id, idempotency_key)
       values ($1, $2, $3, $4::dining_type, 'placed', 'pending', $5, $6, $7, $8,
          $9, $10, $11, $12, $13, 0, $14, $15)`,
      [
        orderId,
        branch.id,
        orderNo,
        input.diningType,
        customer?.id ?? null,
        normalizeText(input.customerName),
        normalizeNullableText(input.customerPhone),
        normalizeNullableText(input.notes),
        moneyString(subtotal),
        moneyString(totals.discountTotal),
        moneyString(totals.taxTotal),
        moneyString(deliveryFee),
        moneyString(totals.grandTotal),
        coupon?.id ?? null,
        randomUUID(),
      ],
    );

    for (const line of input.items) {
      const item = itemById.get(line.itemId)!;
      const lineSubtotal = roundMoney(Number(item.base_price) * line.qty);
      await client.query(
        `insert into order_items
           (order_id, item_id, name_snapshot, unit_price, qty, addons_total, line_subtotal, notes)
         values ($1, $2, $3, $4, $5, 0, $6, $7)`,
        [
          orderId,
          item.id,
          item.name,
          item.base_price,
          line.qty,
          moneyString(lineSubtotal),
          normalizeNullableText(line.notes),
        ],
      );
    }

    for (const tax of totals.taxRows) {
      await client.query(
        `insert into order_taxes (order_id, tax_id, name_snapshot, rate_snapshot, amount)
         values ($1, $2, $3, $4, $5)`,
        [orderId, tax.id, tax.name, rateString(tax.rate), moneyString(tax.amount)],
      );
    }

    await deductOrderInventoryForOrderTx(client, {
      orderId,
      branchId: branch.id,
      actorId: null,
      orderNo,
    });

    await client.query(
      `insert into audit_log
         (restaurant_id, branch_id, actor_id, entity, entity_id, action, meta)
       values ($1, $2, null, 'order', $3, 'customer_placed', $4::jsonb)`,
      [
        branch.restaurant_id,
        branch.id,
        orderId,
        JSON.stringify({ order_no: orderNo, grand_total: totals.grandTotal }),
      ],
    );

    if (customer) {
      await recordCustomerOrder(client, {
        customerId: customer.id,
        restaurantId: branch.restaurant_id,
        branchId: branch.id,
        orderId,
        grandTotal: totals.grandTotal,
        orderNo,
      });
    }

    if (coupon) {
      await recordCouponRedemption(client, {
        coupon,
        orderId,
        customerId: customer?.id ?? null,
        restaurantId: branch.restaurant_id,
        branchId: branch.id,
      });
    }

    await client.query("commit");
    return {
      orderId,
      orderNo,
      grandTotal: totals.grandTotal,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function getBranchForCustomerOrder(client: PoolClient, branchId: string) {
  const result = await client.query<BranchRow>(
    `select id, restaurant_id, code, is_active, delivery_fee
     from branches
     where id = $1`,
    [branchId],
  );
  const branch = result.rows[0];
  if (!branch?.is_active) {
    throw new Error("This branch is not accepting orders.");
  }
  return branch;
}

async function getAvailableMenuItems(
  client: PoolClient,
  branchId: string,
  lines: CustomerOrderInput["items"],
) {
  const requestedItemIds = [...new Set(lines.map((item) => item.itemId))];
  const result = await client.query<MenuItemRow>(
    `select id, branch_id, name, base_price, is_available
     from menu_items
     where id = any($1::uuid[])`,
    [requestedItemIds],
  );
  const itemById = new Map(result.rows.map((item) => [item.id, item]));

  for (const line of lines) {
    assertOrderLine(line.qty);
    const item = itemById.get(line.itemId);
    if (!item || item.branch_id !== branchId || !item.is_available) {
      throw new Error("One or more items are no longer available.");
    }
  }

  return itemById;
}

function calculateSubtotal(
  lines: CustomerOrderInput["items"],
  itemById: Map<string, MenuItemRow>,
) {
  return lines.reduce((sum, line) => {
    const item = itemById.get(line.itemId)!;
    return sum + Number(item.base_price) * line.qty;
  }, 0);
}

async function calculateOrderTotals(
  client: PoolClient,
  input: {
    restaurantId: string;
    subtotal: number;
    deliveryFee: number;
    coupon: ValidCoupon | null;
  },
) {
  const itemDiscount =
    input.coupon?.discountType === "free_delivery" ? 0 : (input.coupon?.discountAmount ?? 0);
  const deliveryDiscount =
    input.coupon?.discountType === "free_delivery" ? (input.coupon?.discountAmount ?? 0) : 0;
  const discountTotal = roundMoney(itemDiscount + deliveryDiscount);
  const taxableBase = Math.max(0, input.subtotal - itemDiscount);
  const taxes = await client.query<{
    id: string;
    name: string;
    rate: string | number;
    is_inclusive: boolean;
  }>(
    `select id, name, rate, is_inclusive
     from taxes
     where restaurant_id = $1 and is_active = true and apply_by_default = true`,
    [input.restaurantId],
  );

  const taxRows = taxes.rows.map((tax) => {
    const rate = Number(tax.rate);
    const amount = tax.is_inclusive
      ? roundMoney(taxableBase - taxableBase / (1 + rate / 100))
      : roundMoney((taxableBase * rate) / 100);
    return {
      id: tax.id,
      name: tax.name,
      rate,
      isInclusive: tax.is_inclusive,
      amount,
    };
  });
  const taxTotal = taxRows
    .filter((tax) => !tax.isInclusive)
    .reduce((sum, tax) => sum + tax.amount, 0);

  return {
    discountTotal,
    taxRows,
    taxTotal,
    grandTotal: roundMoney(taxableBase + taxTotal + input.deliveryFee - deliveryDiscount),
  };
}

async function findOrCreateCustomer(
  client: PoolClient,
  input: {
    restaurantId: string;
    branchId: string;
    name: string | null | undefined;
    phone: string | null | undefined;
    notes: string | null | undefined;
  },
) {
  const phone = normalizeNullableText(input.phone);
  const phoneNormalized = normalizePhone(phone);
  const name = normalizeNullableText(input.name);
  const identityKey = phoneNormalized || nameIdentityKey(name);
  if (!identityKey) return null;

  const context = parseCustomerContext(input.notes);
  const result = await client.query<CustomerRow>(
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
  const customer = result.rows[0];

  if (customer && context.address) {
    await client.query(
      `insert into customer_addresses (customer_id, address, is_default)
       values ($1, $2, true)
       on conflict do nothing`,
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
    `insert into customer_events
       (customer_id, restaurant_id, branch_id, order_id, event_type, meta)
     values ($1, $2, $3, $4, 'order_placed', $5::jsonb)`,
    [
      input.customerId,
      input.restaurantId,
      input.branchId,
      input.orderId,
      JSON.stringify({ order_no: input.orderNo, grand_total: input.grandTotal }),
    ],
  );
}

async function reserveNextOrderNumber(
  client: PoolClient,
  branchId: string,
  branchCode: string,
) {
  const today = utcDateString();
  const result = await client.query<{ last_seq: number }>(
    `insert into order_counters (branch_id, counter_date, last_seq)
     values ($1, $2, 1)
     on conflict (branch_id, counter_date) do update
       set last_seq = order_counters.last_seq + 1
     returning last_seq`,
    [branchId, today],
  );
  const sequence = result.rows[0]?.last_seq ?? 1;

  return `AK-${branchCode || "BR"}-${today.replaceAll("-", "")}-${String(sequence).padStart(
    4,
    "0",
  )}`;
}

function assertOrderLine(qty: number) {
  if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
    throw new Error("Order item quantity must be between 1 and 50.");
  }
}

function normalizeText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Required order text fields cannot be blank.");
  }

  return trimmed;
}

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed || null;
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
  const raw = normalizeNullableText(notes);
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

function utcDateString() {
  return new Date().toISOString().slice(0, 10);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function moneyString(value: number) {
  return roundMoney(value).toFixed(2);
}

function rateString(value: number) {
  return value.toFixed(3);
}
