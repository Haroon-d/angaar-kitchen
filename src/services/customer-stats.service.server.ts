import type { PoolClient } from "pg";
import { pgPool } from "@/db/client.server";

export async function recalculateCustomerStats(customerId: string, client?: PoolClient) {
  if (client) {
    return recalculateWithClient(client, customerId);
  }

  const pooledClient = await pgPool.connect();
  try {
    return await recalculateWithClient(pooledClient, customerId);
  } finally {
    pooledClient.release();
  }
}

async function recalculateWithClient(client: PoolClient, customerId: string) {
  const result = await client.query(
    `
    with order_stats as (
      select
        count(*) filter (
          where status not in ('cancelled', 'voided', 'refunded')
        )::int as total_orders,
        coalesce(sum(grand_total) filter (
          where status = 'completed' and payment_status = 'paid'
        ), 0)::numeric(14, 2) as total_spent,
        min(created_at) filter (
          where status not in ('cancelled', 'voided', 'refunded')
        ) as first_order_at,
        max(created_at) filter (
          where status not in ('cancelled', 'voided', 'refunded')
        ) as last_order_at
      from orders
      where customer_id = $1
    )
    update customers
    set
      total_orders = coalesce(order_stats.total_orders, 0),
      total_spent = coalesce(order_stats.total_spent, 0),
      first_order_at = order_stats.first_order_at,
      last_order_at = order_stats.last_order_at,
      updated_at = now()
    from order_stats
    where customers.id = $1
    returning
      customers.id,
      customers.total_orders,
      customers.total_spent,
      customers.first_order_at,
      customers.last_order_at
    `,
    [customerId],
  );

  if (!result.rowCount) {
    throw new Error("Customer was not found.");
  }

  return result.rows[0] as {
    id: string;
    total_orders: number;
    total_spent: string;
    first_order_at: string | null;
    last_order_at: string | null;
  };
}
