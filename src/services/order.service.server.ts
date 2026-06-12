import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pgPool } from "@/db/client.server";
import {
  auditLog,
  branches,
  customerAddresses,
  customerEvents,
  customers,
  menuItems,
  orderCounters,
  orderItems,
  orders,
  orderTaxes,
  taxes,
} from "@/db/schema";
import { validateCoupon } from "@/services/coupon.service.server";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CustomerOrderInput = {
  branchId: string;
  diningType: "takeaway" | "delivery";
  customerName: string;
  customerPhone: string;
  notes?: string | null;
  couponCode?: string | null;
  items: Array<{
    itemId: string;
    qty: number;
    notes?: string | null;
  }>;
};

export async function createCustomerOrder(input: CustomerOrderInput) {
  if (!input.items.length) {
    throw new Error("Order must contain at least one item.");
  }

  const result = await db.transaction(async (tx) => {
    const [branch] = await tx
      .select()
      .from(branches)
      .where(eq(branches.id, input.branchId))
      .limit(1);

    if (!branch?.isActive) {
      throw new Error("This branch is not accepting orders.");
    }

    const requestedItemIds = [...new Set(input.items.map((item) => item.itemId))];
    const availableItems = await tx
      .select()
      .from(menuItems)
      .where(inArray(menuItems.id, requestedItemIds));

    const itemById = new Map(availableItems.map((item) => [item.id, item]));
    let subtotal = 0;

    for (const line of input.items) {
      assertOrderLine(line.qty);

      const item = itemById.get(line.itemId);
      if (!item || item.branchId !== branch.id || !item.isAvailable) {
        throw new Error("One or more items are no longer available.");
      }

      subtotal += Number(item.basePrice) * line.qty;
    }

    const customer = await findOrCreateCustomer(tx, {
      restaurantId: branch.restaurantId,
      branchId: branch.id,
      name: input.customerName,
      phone: input.customerPhone,
      notes: input.notes,
    });
    if (customer?.isBlocked) {
      throw new Error("This customer is blocked. Please review the customer profile before taking an order.");
    }
    const deliveryFee = input.diningType === "delivery" ? roundMoney(Number(branch.deliveryFee ?? 0)) : 0;
    const coupon = await validateCouponForOrder({
      restaurantId: branch.restaurantId,
      branchId: branch.id,
      code: input.couponCode,
      subtotal,
      deliveryFee,
      customerId: customer?.id ?? null,
      source: "website",
    });
    const itemDiscount = coupon?.discountType === "free_delivery" ? 0 : (coupon?.discountAmount ?? 0);
    const deliveryDiscount = coupon?.discountType === "free_delivery" ? (coupon?.discountAmount ?? 0) : 0;
    const discountTotal = roundMoney(itemDiscount + deliveryDiscount);
    const taxableBase = Math.max(0, subtotal - itemDiscount);
    const activeTaxes = await tx
      .select()
      .from(taxes)
      .where(
        and(
          eq(taxes.restaurantId, branch.restaurantId),
          eq(taxes.isActive, true),
          eq(taxes.applyByDefault, true),
        ),
      );

    const taxRows = activeTaxes.map((tax) => {
      const rate = Number(tax.rate);
      const amount = tax.isInclusive
        ? roundMoney(taxableBase - taxableBase / (1 + rate / 100))
        : roundMoney((taxableBase * rate) / 100);

      return {
        id: tax.id,
        name: tax.name,
        rate,
        isInclusive: tax.isInclusive,
        amount,
      };
    });

    const taxTotal = taxRows
      .filter((tax) => !tax.isInclusive)
      .reduce((sum, tax) => sum + tax.amount, 0);
    const grandTotal = roundMoney(taxableBase + taxTotal + deliveryFee - deliveryDiscount);
    const orderNo = await reserveNextOrderNumber(tx, branch.id, branch.code);
    const orderId = randomUUID();

    await tx.insert(orders).values({
      id: orderId,
      branchId: branch.id,
      orderNo,
      diningType: input.diningType,
      status: "placed",
      paymentStatus: "pending",
      customerId: customer?.id ?? null,
      customerName: normalizeText(input.customerName),
      customerPhone: normalizeText(input.customerPhone),
      notes: normalizeNullableText(input.notes),
      subtotal: moneyString(subtotal),
      discountTotal: moneyString(discountTotal),
      taxTotal: moneyString(taxTotal),
      deliveryFee: moneyString(deliveryFee),
      grandTotal: moneyString(grandTotal),
      amountPaid: "0.00",
      couponId: coupon?.id ?? null,
      idempotencyKey: randomUUID(),
    });

    await tx.insert(orderItems).values(
      input.items.map((line) => {
        const item = itemById.get(line.itemId)!;
        const lineSubtotal = roundMoney(Number(item.basePrice) * line.qty);

        return {
          orderId,
          itemId: item.id,
          nameSnapshot: item.name,
          unitPrice: item.basePrice,
          qty: line.qty,
          addonsTotal: "0.00",
          lineSubtotal: moneyString(lineSubtotal),
          notes: normalizeNullableText(line.notes),
        };
      }),
    );

    if (taxRows.length) {
      await tx.insert(orderTaxes).values(
        taxRows.map((tax) => ({
          orderId,
          taxId: tax.id,
          nameSnapshot: tax.name,
          rateSnapshot: rateString(tax.rate),
          amount: moneyString(tax.amount),
        })),
      );
    }

    await tx.insert(auditLog).values({
      restaurantId: branch.restaurantId,
      branchId: branch.id,
      actorId: null,
      entity: "order",
      entityId: orderId,
      action: "customer_placed",
      meta: {
        order_no: orderNo,
        grand_total: grandTotal,
      },
    });

    if (customer) {
      await recordCustomerOrder(tx, {
        customerId: customer.id,
        restaurantId: branch.restaurantId,
        branchId: branch.id,
        orderId,
        grandTotal,
        orderNo,
      });
    }
    if (coupon) {
      await tx.execute(sql`
        insert into coupon_redemptions (
          coupon_id,
          order_id,
          customer_id,
          restaurant_id,
          branch_id,
          code_snapshot,
          discount_amount
        )
        values (
          ${coupon.id},
          ${orderId},
          ${customer?.id ?? null},
          ${branch.restaurantId},
          ${branch.id},
          ${coupon.code},
          ${moneyString(coupon.discountAmount)}::numeric
        )
        on conflict (coupon_id, order_id) do nothing
      `);
    }
    return {
      orderId,
      orderNo,
      grandTotal,
    };
  });

  return {
    orderId: result.orderId,
    orderNo: result.orderNo,
    grandTotal: result.grandTotal,
  };
}

async function validateCouponForOrder(input: Parameters<typeof validateCoupon>[1]) {
  const client = await pgPool.connect();
  try {
    return validateCoupon(client, input);
  } finally {
    client.release();
  }
}

async function findOrCreateCustomer(
  tx: DbTx,
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
  if (!phone || !phoneNormalized) return null;

  const name = normalizeNullableText(input.name);
  const context = parseCustomerContext(input.notes);
  const [customer] = await tx
    .insert(customers)
    .values({
      restaurantId: input.restaurantId,
      branchId: input.branchId,
      name,
      primaryPhone: phone,
      phoneNormalized,
      defaultAddress: context.address,
      notes: context.preferenceNote,
    })
    .onConflictDoUpdate({
      target: [customers.restaurantId, customers.phoneNormalized],
      set: {
        branchId: input.branchId,
        name: sql`coalesce(excluded.name, ${customers.name})`,
        primaryPhone: sql`excluded.primary_phone`,
        defaultAddress: sql`coalesce(${customers.defaultAddress}, excluded.default_address)`,
        notes: sql`coalesce(${customers.notes}, excluded.notes)`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: customers.id, isBlocked: customers.isBlocked });

  if (context.address) {
    await tx
      .insert(customerAddresses)
      .values({
        customerId: customer.id,
        address: context.address,
        isDefault: true,
      })
      .onConflictDoNothing();
  }

  return customer;
}

async function recordCustomerOrder(
  tx: DbTx,
  input: {
    customerId: string;
    restaurantId: string;
    branchId: string;
    orderId: string;
    orderNo: string;
    grandTotal: number;
  },
) {
  await tx
    .update(customers)
    .set({
      firstOrderAt: sql`coalesce(${customers.firstOrderAt}, now())`,
      lastOrderAt: sql`now()`,
      totalOrders: sql`${customers.totalOrders} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(customers.id, input.customerId));

  await tx.insert(customerEvents).values({
    customerId: input.customerId,
    restaurantId: input.restaurantId,
    branchId: input.branchId,
    orderId: input.orderId,
    eventType: "order_placed",
    meta: {
      order_no: input.orderNo,
      grand_total: input.grandTotal,
    },
  });
}

async function reserveNextOrderNumber(
  tx: DbTx,
  branchId: string,
  branchCode: string,
) {
  const today = utcDateString();
  const [counter] = await tx
    .insert(orderCounters)
    .values({
      branchId,
      counterDate: today,
      lastSeq: 1,
    })
    .onConflictDoUpdate({
      target: [orderCounters.branchId, orderCounters.counterDate],
      set: {
        lastSeq: sql`${orderCounters.lastSeq} + 1`,
      },
    })
    .returning({
      lastSeq: orderCounters.lastSeq,
    });

  return `AK-${branchCode || "BR"}-${today.replaceAll("-", "")}-${String(counter.lastSeq).padStart(
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
