import type { PoolClient } from "pg";
import { pgPool } from "@/db/client.server";
import { MANAGER_ROLES, requireRestaurantRole } from "@/services/authorization.service.server";

export type MergeCustomersResult = {
  targetCustomerId: string;
  sourceCustomerId: string;
  movedOrders: number;
  movedAddresses: number;
  movedEvents: number;
};

export async function mergeCustomers(input: {
  actorId: string;
  targetCustomerId: string;
  sourceCustomerId: string;
}): Promise<MergeCustomersResult> {
  if (input.targetCustomerId === input.sourceCustomerId) {
    throw new Error("Choose two different customers to merge.");
  }

  const client = await pgPool.connect();
  try {
    await client.query("begin");

    const { target, source } = await loadMergeCustomers(
      client,
      input.targetCustomerId,
      input.sourceCustomerId,
    );

    if (target.restaurant_id !== source.restaurant_id) {
      throw new Error("Customers from different restaurants cannot be merged.");
    }

    await requireRestaurantRole(input.actorId, target.restaurant_id, MANAGER_ROLES);

    const addressInsert = await client.query(
      `
        insert into customer_addresses (
          customer_id,
          label,
          address,
          area,
          city,
          instructions,
          is_default,
          created_at,
          updated_at
        )
        select
          $1,
          label,
          address,
          area,
          city,
          instructions,
          case
            when exists (
              select 1 from customer_addresses existing
              where existing.customer_id = $1 and existing.is_default = true
            )
            then false
            else is_default
          end,
          created_at,
          now()
        from customer_addresses
        where customer_id = $2
        on conflict (customer_id, address) do nothing
      `,
      [target.id, source.id],
    );

    await client.query("delete from customer_addresses where customer_id = $1", [source.id]);

    const ordersUpdate = await client.query(
      "update orders set customer_id = $1, updated_at = now() where customer_id = $2",
      [target.id, source.id],
    );

    const eventsUpdate = await client.query(
      "update customer_events set customer_id = $1 where customer_id = $2",
      [target.id, source.id],
    );

    await client.query(
      `
        update customers
        set
          name = coalesce(nullif(customers.name, ''), nullif($2, '')),
          primary_phone = coalesce(nullif(customers.primary_phone, ''), $3),
          email = coalesce(nullif(customers.email, ''), nullif($4, '')),
          default_address = coalesce(nullif(customers.default_address, ''), nullif($5, '')),
          notes = nullif(concat_ws(E'\n', nullif(customers.notes, ''), nullif($6, '')), ''),
          spice_preference = coalesce(nullif(customers.spice_preference, ''), nullif($7, '')),
          is_vip = customers.is_vip or $8,
          is_blocked = customers.is_blocked or $9,
          first_order_at = stats.first_order_at,
          last_order_at = stats.last_order_at,
          total_orders = stats.total_orders,
          total_spent = stats.total_spent,
          updated_at = now()
        from (
          select
            min(created_at) filter (
              where status not in ('cancelled', 'voided', 'refunded')
            ) as first_order_at,
            max(created_at) filter (
              where status not in ('cancelled', 'voided', 'refunded')
            ) as last_order_at,
            count(*) filter (
              where status not in ('cancelled', 'voided', 'refunded')
            )::int as total_orders,
            coalesce(sum(grand_total) filter (
              where status = 'completed' and payment_status = 'paid'
            ), 0)::numeric(14, 2) as total_spent
          from orders
          where customer_id = $1
        ) stats
        where customers.id = $1
      `,
      [
        target.id,
        source.name,
        source.primary_phone,
        source.email,
        source.default_address,
        source.notes,
        source.spice_preference,
        source.is_vip,
        source.is_blocked,
      ],
    );

    await client.query(
      `
        insert into customer_events (
          customer_id,
          restaurant_id,
          branch_id,
          event_type,
          meta
        )
        values ($1, $2, $3, 'customer_merged', $4::jsonb)
      `,
      [
        target.id,
        target.restaurant_id,
        target.branch_id ?? source.branch_id,
        JSON.stringify({
          source_customer_id: source.id,
          source_name: source.name,
          source_phone: source.primary_phone,
          moved_orders: ordersUpdate.rowCount ?? 0,
          moved_addresses: addressInsert.rowCount ?? 0,
          moved_events: eventsUpdate.rowCount ?? 0,
        }),
      ],
    );

    await client.query("delete from customers where id = $1", [source.id]);
    await client.query("commit");

    return {
      targetCustomerId: target.id,
      sourceCustomerId: source.id,
      movedOrders: ordersUpdate.rowCount ?? 0,
      movedAddresses: addressInsert.rowCount ?? 0,
      movedEvents: eventsUpdate.rowCount ?? 0,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function loadMergeCustomers(
  client: PoolClient,
  targetCustomerId: string,
  sourceCustomerId: string,
) {
  const result = await client.query<{
    id: string;
    restaurant_id: string;
    branch_id: string | null;
    name: string | null;
    primary_phone: string;
    email: string | null;
    default_address: string | null;
    notes: string | null;
    spice_preference: string | null;
    is_vip: boolean;
    is_blocked: boolean;
  }>(
    `
      select
        id,
        restaurant_id,
        branch_id,
        name,
        primary_phone,
        email,
        default_address,
        notes,
        spice_preference,
        is_vip,
        is_blocked
      from customers
      where id in ($1, $2)
      for update
    `,
    [targetCustomerId, sourceCustomerId],
  );

  const target = result.rows.find((row) => row.id === targetCustomerId);
  const source = result.rows.find((row) => row.id === sourceCustomerId);
  if (!target || !source) {
    throw new Error("Could not find both customers to merge.");
  }

  return { target, source };
}
