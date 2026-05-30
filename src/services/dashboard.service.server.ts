import { and, desc, eq, gte, inArray, lt, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db/client.server";
import {
  inventoryItems,
  inventoryMovements,
  menuCategories,
  menuItems,
  operationalExpenses,
  orderItems,
  orders,
} from "@/db/schema";
import { requireBranchRole } from "@/services/authorization.service.server";

export async function getDashboardSummary(input: {
  userId: string;
  branchId: string;
  startAt: string;
  endAt: string;
  startDate: string;
  endDate: string;
  includeUsage: boolean;
}) {
  await requireBranchRole(input.userId, input.branchId);

  const orderRows = await db
    .select({
      id: orders.id,
      orderNo: orders.orderNo,
      diningType: orders.diningType,
      status: orders.status,
      grandTotal: orders.grandTotal,
      createdAt: orders.createdAt,
      customerName: orders.customerName,
    })
    .from(orders)
    .where(
      and(
        eq(orders.branchId, input.branchId),
        gte(orders.createdAt, new Date(input.startAt)),
        lt(orders.createdAt, new Date(input.endAt)),
      ),
    )
    .orderBy(desc(orders.createdAt));

  const completedOrderIds = orderRows
    .filter((order) => order.status === "completed")
    .map((order) => order.id);

  const saleMovements = completedOrderIds.length
    ? await db
        .select({
          relatedOrderId: inventoryMovements.relatedOrderId,
          quantityDelta: inventoryMovements.quantityDelta,
          unitCost: inventoryMovements.unitCost,
        })
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.branchId, input.branchId),
            eq(inventoryMovements.movementType, "sale"),
            inArray(inventoryMovements.relatedOrderId, completedOrderIds),
          ),
        )
    : [];

  let inventoryCost = 0;
  const costByOrder: Record<string, number> = {};
  for (const movement of saleMovements) {
    const lineCost = Math.abs(Number(movement.quantityDelta || 0)) * Number(movement.unitCost || 0);
    inventoryCost += lineCost;
    if (movement.relatedOrderId) {
      costByOrder[movement.relatedOrderId] = (costByOrder[movement.relatedOrderId] ?? 0) + lineCost;
    }
  }

  const [expenseTotal] = await db
    .select({
      total: sql<string>`coalesce(sum(${operationalExpenses.amount}), 0)`,
    })
    .from(operationalExpenses)
    .where(
      and(
        eq(operationalExpenses.branchId, input.branchId),
        gte(operationalExpenses.expenseDate, input.startDate),
        lte(operationalExpenses.expenseDate, input.endDate),
        ne(operationalExpenses.status, "void"),
      ),
    );

  const [lowStock] = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.branchId, input.branchId),
        eq(inventoryItems.isActive, true),
        sql`${inventoryItems.currentQty} <= ${inventoryItems.reorderLevel}`,
      ),
    );

  const usageRows = input.includeUsage
    ? await getItemUsage(input.branchId, input.startAt, input.endAt)
    : [];

  return {
    orders: orderRows.map((order) => ({
      id: order.id,
      order_no: order.orderNo,
      dining_type: order.diningType,
      status: order.status,
      grand_total: order.grandTotal,
      created_at: order.createdAt.toISOString(),
      customer_name: order.customerName,
    })),
    inventoryCost,
    costByOrder,
    otherCosts: Number(expenseTotal?.total ?? 0),
    lowStockCount: Number(lowStock?.count ?? 0),
    usageRows,
  };
}

async function getItemUsage(branchId: string, startAt: string, endAt: string) {
  const menuUsage = await db
    .select({
      reportType: sql<"menu_item">`'menu_item'`,
      itemId: orderItems.itemId,
      itemName: sql<string>`coalesce(${menuItems.name}, ${orderItems.nameSnapshot})`,
      category: menuCategories.name,
      unit: sql<string | null>`null`,
      quantity: sql<string>`coalesce(sum(${orderItems.qty}), 0)`,
      completedQuantity: sql<string>`coalesce(sum(case when ${orders.status} = 'completed' then ${orderItems.qty} else 0 end), 0)`,
      activeQuantity: sql<string>`coalesce(sum(case when ${orders.status} not in ('completed', 'cancelled', 'voided', 'refunded') then ${orderItems.qty} else 0 end), 0)`,
      revenue: sql<string>`coalesce(sum(${orderItems.lineSubtotal} + ${orderItems.addonsTotal}), 0)`,
      cost: sql<string>`0`,
      orderCount: sql<string>`count(distinct ${orders.id})`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .leftJoin(menuItems, eq(menuItems.id, orderItems.itemId))
    .leftJoin(menuCategories, eq(menuCategories.id, menuItems.categoryId))
    .where(
      and(
        eq(orders.branchId, branchId),
        gte(orders.createdAt, new Date(startAt)),
        lt(orders.createdAt, new Date(endAt)),
      ),
    )
    .groupBy(orderItems.itemId, orderItems.nameSnapshot, menuItems.name, menuCategories.name)
    .orderBy(sql`sum(${orderItems.qty}) desc`);

  const inventoryUsage = await db
    .select({
      reportType: sql<"inventory_item">`'inventory_item'`,
      itemId: inventoryMovements.inventoryItemId,
      itemName: inventoryItems.name,
      category: inventoryItems.category,
      unit: inventoryItems.baseUnit,
      quantity: sql<string>`coalesce(sum(abs(${inventoryMovements.quantityDelta})), 0)`,
      completedQuantity: sql<string>`coalesce(sum(abs(${inventoryMovements.quantityDelta})), 0)`,
      activeQuantity: sql<string>`0`,
      revenue: sql<string>`0`,
      cost: sql<string>`coalesce(sum(abs(${inventoryMovements.quantityDelta}) * ${inventoryMovements.unitCost}), 0)`,
      orderCount: sql<string>`count(distinct ${inventoryMovements.relatedOrderId})`,
    })
    .from(inventoryMovements)
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryMovements.inventoryItemId))
    .where(
      and(
        eq(inventoryMovements.branchId, branchId),
        eq(inventoryMovements.movementType, "sale"),
        gte(inventoryMovements.createdAt, new Date(startAt)),
        lt(inventoryMovements.createdAt, new Date(endAt)),
      ),
    )
    .groupBy(
      inventoryMovements.inventoryItemId,
      inventoryItems.name,
      inventoryItems.category,
      inventoryItems.baseUnit,
    )
    .orderBy(sql`sum(abs(${inventoryMovements.quantityDelta})) desc`);

  return [...menuUsage, ...inventoryUsage].map((row) => ({
    report_type: row.reportType,
    item_id: row.itemId,
    item_name: row.itemName,
    category: row.category,
    unit: row.unit,
    quantity: Number(row.quantity ?? 0),
    completed_quantity: Number(row.completedQuantity ?? 0),
    active_quantity: Number(row.activeQuantity ?? 0),
    revenue: Number(row.revenue ?? 0),
    cost: Number(row.cost ?? 0),
    order_count: Number(row.orderCount ?? 0),
  }));
}
