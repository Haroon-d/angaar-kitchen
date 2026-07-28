import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePostgresAuth } from "@/integrations/postgres/auth-middleware";
import { pgPool } from "@/db/client.server";
import { mergeCustomers } from "@/services/customer-merge.service.server";
import { recalculateCustomerStats } from "@/services/customer-stats.service.server";

const MergeCustomersSchema = z.object({
  targetCustomerId: z.string().uuid(),
  sourceCustomerId: z.string().uuid(),
});

export const mergeCustomersPostgres = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => MergeCustomersSchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    return mergeCustomers({
      actorId: auth.userId,
      targetCustomerId: data.targetCustomerId,
      sourceCustomerId: data.sourceCustomerId,
    });
  });

export const recalculateCustomerStatsPostgres = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => RecalculateCustomerStatsSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireAuthContext(context);
    return recalculateCustomerStats(data.customerId);
  });

const RecalculateCustomerStatsSchema = z.object({
  customerId: z.string().uuid(),
});

const SearchCustomersSchema = z.object({
  branchId: z.string().uuid(),
  query: z.string().trim().min(2).max(80),
});

const ListCustomersSchema = z.object({
  restaurantId: z.string().uuid(),
  search: z.string().trim().max(80).optional().default(""),
});

export const listCustomersPostgres = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => ListCustomersSchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    const text = data.search.trim();
    const digits = normalizePhone(text);
    const searchActive = text.length >= 2;
    const result = await pgPool.query(
      `
      with visible_customers as (
        select
          c.id,
          c.restaurant_id,
          c.branch_id,
          c.name,
          c.primary_phone,
          c.phone_normalized,
          c.email,
          c.default_address,
          c.notes,
          c.spice_preference,
          c.is_vip,
          c.is_blocked,
          c.first_order_at,
          c.last_order_at,
          c.total_orders,
          c.total_spent,
          c.created_at,
          c.updated_at,
          case
            when c.phone_normalized <> '' then c.phone_normalized
            else 'name:' || regexp_replace(
              regexp_replace(lower(trim(coalesce(c.name, ''))), '[^a-z0-9]+', '-', 'g'),
              '(^-+|-+$)',
              '',
              'g'
            )
          end as identity_key,
          case
            when $5::text <> '' and c.phone_normalized = trim(trailing '%' from $5::text) then 0
            else 1
          end as match_rank
        from customers c
        where c.restaurant_id = $2
          and exists (
            select 1
            from user_roles ur
            where ur.user_id = $1
              and ur.restaurant_id = c.restaurant_id
          )
          and (
            $3::boolean = false
            or lower(coalesce(c.name, '')) like $4
            or lower(c.primary_phone) like $4
            or lower(coalesce(c.email, '')) like $4
            or lower(coalesce(c.default_address, '')) like $4
            or lower(coalesce(c.notes, '')) like $4
            or ($5::text <> '' and c.phone_normalized like $5)
          )
      ),
      ranked as (
        select
          *,
          row_number() over (
            partition by identity_key
            order by match_rank, total_orders desc, total_spent::numeric desc, last_order_at desc nulls last, updated_at desc
          ) as identity_rank
        from visible_customers
      )
      select
        id,
        restaurant_id,
        branch_id,
        name,
        primary_phone,
        phone_normalized,
        email,
        default_address,
        notes,
        spice_preference,
        is_vip,
        is_blocked,
        first_order_at,
        last_order_at,
        total_orders,
        total_spent,
        created_at,
        updated_at
      from ranked
      where identity_rank = 1
      order by
        match_rank,
        last_order_at desc nulls last,
        total_orders desc,
        created_at desc
      limit 500
      `,
      [
        auth.userId,
        data.restaurantId,
        searchActive,
        `%${text.toLowerCase()}%`,
        digits ? `${digits}%` : "",
      ],
    );

    return result.rows;
  });

export const searchCustomersForPosPostgres = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => SearchCustomersSchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    const digits = normalizePhone(data.query);
    const text = data.query.trim();
    const params = [
      auth.userId,
      data.branchId,
      digits ? `${digits}%` : null,
      `%${text.toLowerCase()}%`,
    ];

    const result = await pgPool.query<{
      id: string;
      name: string | null;
      primary_phone: string;
      default_address: string | null;
      spice_preference: string | null;
      is_blocked: boolean;
      total_orders: number;
      total_spent: string | number;
      last_order_at: Date | null;
    }>(
      `
      with scoped_branch as (
        select b.id, b.restaurant_id
        from branches b
        where b.id = $2
          and exists (
            select 1
            from user_roles ur
            where ur.user_id = $1
              and ur.restaurant_id = b.restaurant_id
              and (ur.branch_id is null or ur.branch_id = b.id)
          )
      )
      , matched as (
        select
          c.id,
          c.name,
          c.primary_phone,
          c.default_address,
          c.spice_preference,
          c.is_blocked,
          c.total_orders,
          c.total_spent,
          c.last_order_at,
          case
            when c.phone_normalized <> '' then c.phone_normalized
            else 'name:' || regexp_replace(
              regexp_replace(lower(trim(coalesce(c.name, ''))), '[^a-z0-9]+', '-', 'g'),
              '(^-+|-+$)',
              '',
              'g'
            )
          end as identity_key,
          case
            when $3::text is not null and c.phone_normalized = trim(trailing '%' from $3::text) then 0
            else 1
          end as match_rank
        from customers c
        join scoped_branch sb on sb.restaurant_id = c.restaurant_id
        where (
          ($3::text is not null and c.phone_normalized like $3)
          or lower(coalesce(c.name, '')) like $4
          or lower(c.primary_phone) like $4
        )
      ),
      ranked as (
        select
          *,
          row_number() over (
            partition by identity_key
            order by match_rank, total_orders desc, total_spent::numeric desc, last_order_at desc nulls last
          ) as identity_rank
        from matched
      )
      select
        id,
        name,
        primary_phone,
        default_address,
        spice_preference,
        is_blocked,
        total_orders,
        total_spent,
        last_order_at
      from ranked
      where identity_rank = 1
      order by
        match_rank,
        last_order_at desc nulls last,
        total_orders desc
      limit 6
      `,
      params,
    );

    return result.rows.map((customer) => ({
      id: customer.id,
      name: customer.name,
      phone: customer.primary_phone,
      defaultAddress: customer.default_address,
      spicePreference: customer.spice_preference,
      isBlocked: customer.is_blocked,
      totalOrders: Number(customer.total_orders ?? 0),
      totalSpent: Number(customer.total_spent ?? 0),
      lastOrderAt: customer.last_order_at?.toISOString() ?? null,
    }));
  });

function normalizePhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("0")) return `92${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("3")) return `92${digits}`;
  return digits;
}

function requireAuthContext(context: { userId: string } | undefined) {
  if (!context) {
    throw new Response("Unauthorized", { status: 401 });
  }

  return context;
}
