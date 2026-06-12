import type { PoolClient } from "pg";
import { pgPool } from "@/db/client.server";

export type CouponSource = "pos" | "website";

export type CouponValidationInput = {
  restaurantId: string;
  branchId: string;
  code: string | null | undefined;
  subtotal: number;
  deliveryFee?: number;
  customerId?: string | null;
  source: CouponSource;
};

export type ValidCoupon = {
  id: string;
  code: string;
  name: string;
  discountType: "amount" | "percent" | "free_delivery";
  discountValue: number;
  discountAmount: number;
};

export async function validateCoupon(
  client: PoolClient,
  input: CouponValidationInput,
): Promise<ValidCoupon | null> {
  const code = normalizeCouponCode(input.code);
  if (!code) return null;

  const result = await client.query(
    `
    select *
    from coupon_campaigns
    where restaurant_id = $1
      and code = $2
      and is_active = true
      and applies_to in ('both', $3::coupon_applies_to)
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at >= now())
    limit 1
    `,
    [input.restaurantId, code, input.source],
  );
  const coupon = result.rows[0];
  if (!coupon) throw new Error("Coupon is invalid or expired.");

  const subtotal = roundMoney(input.subtotal);
  if (subtotal < Number(coupon.min_order_total || 0)) {
    throw new Error(`Coupon requires an order of at least Rs ${Number(coupon.min_order_total).toLocaleString("en-PK")}.`);
  }

  if (coupon.usage_limit !== null) {
    const used = await client.query(
      "select count(*)::int as count from coupon_redemptions where coupon_id = $1",
      [coupon.id],
    );
    if (Number(used.rows[0]?.count ?? 0) >= Number(coupon.usage_limit)) {
      throw new Error("Coupon usage limit has been reached.");
    }
  }

  if (input.customerId && Number(coupon.per_customer_limit ?? 0) > 0) {
    const usedByCustomer = await client.query(
      "select count(*)::int as count from coupon_redemptions where coupon_id = $1 and customer_id = $2",
      [coupon.id, input.customerId],
    );
    if (Number(usedByCustomer.rows[0]?.count ?? 0) >= Number(coupon.per_customer_limit)) {
      throw new Error("This customer has already used this coupon.");
    }
  }

  const discountAmount = calculateCouponDiscount({
    subtotal,
    deliveryFee: roundMoney(input.deliveryFee ?? 0),
    type: coupon.discount_type,
    value: Number(coupon.discount_value),
    maxDiscount: coupon.max_discount === null ? null : Number(coupon.max_discount),
  });

  if (discountAmount <= 0) {
    throw new Error("Coupon does not apply a discount to this order.");
  }

  return {
    id: coupon.id,
    code: coupon.code,
    name: coupon.name,
    discountType: coupon.discount_type,
    discountValue: Number(coupon.discount_value),
    discountAmount,
  };
}

export async function recordCouponRedemption(
  client: PoolClient,
  input: {
    coupon: ValidCoupon;
    orderId: string;
    customerId: string | null;
    restaurantId: string;
    branchId: string;
  },
) {
  await client.query(
    `
    insert into coupon_redemptions (
      coupon_id,
      order_id,
      customer_id,
      restaurant_id,
      branch_id,
      code_snapshot,
      discount_amount
    )
    values ($1, $2, $3, $4, $5, $6, $7)
    on conflict (coupon_id, order_id) do nothing
    `,
    [
      input.coupon.id,
      input.orderId,
      input.customerId,
      input.restaurantId,
      input.branchId,
      input.coupon.code,
      moneyString(input.coupon.discountAmount),
    ],
  );
}

export async function previewCoupon(input: CouponValidationInput) {
  const client = await pgPool.connect();
  try {
    return validateCoupon(client, input);
  } finally {
    client.release();
  }
}

function calculateCouponDiscount(input: {
  subtotal: number;
  deliveryFee: number;
  type: string;
  value: number;
  maxDiscount: number | null;
}) {
  if (input.type === "free_delivery") {
    if (input.deliveryFee <= 0) {
      throw new Error("Free delivery coupon only applies to delivery orders.");
    }
    return roundMoney(input.deliveryFee);
  }

  const rawDiscount =
    input.type === "percent" ? (input.subtotal * input.value) / 100 : input.value;
  const cappedDiscount =
    input.maxDiscount !== null ? Math.min(rawDiscount, input.maxDiscount) : rawDiscount;
  return roundMoney(Math.max(0, Math.min(input.subtotal, cappedDiscount)));
}

function normalizeCouponCode(value: string | null | undefined) {
  return value?.trim().toUpperCase().replace(/\s+/g, "") || "";
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function moneyString(value: number) {
  return roundMoney(value).toFixed(2);
}
