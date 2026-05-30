import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client.server";
import {
  auditLog,
  branches,
  menuItems,
  orderCounters,
  orderItems,
  orders,
  orderTaxes,
  taxes,
} from "@/db/schema";

export type CustomerOrderInput = {
  branchId: string;
  diningType: "takeaway" | "delivery";
  customerName: string;
  customerPhone: string;
  notes?: string | null;
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

  return db.transaction(async (tx) => {
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
        ? roundMoney(subtotal - subtotal / (1 + rate / 100))
        : roundMoney((subtotal * rate) / 100);

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
    const grandTotal = roundMoney(subtotal + taxTotal);
    const orderNo = await reserveNextOrderNumber(tx, branch.id, branch.code);
    const orderId = randomUUID();

    await tx.insert(orders).values({
      id: orderId,
      branchId: branch.id,
      orderNo,
      diningType: input.diningType,
      status: "open",
      paymentStatus: "pending",
      customerName: normalizeText(input.customerName),
      customerPhone: normalizeText(input.customerPhone),
      notes: normalizeNullableText(input.notes),
      subtotal: moneyString(subtotal),
      discountTotal: "0.00",
      taxTotal: moneyString(taxTotal),
      grandTotal: moneyString(grandTotal),
      amountPaid: "0.00",
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

    return {
      orderId,
      orderNo,
      grandTotal,
    };
  });
}

async function reserveNextOrderNumber(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
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
