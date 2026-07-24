import { pgPool } from "@/db/client.server";

export type CustomerSelfServiceLookup = {
  customer: {
    name: string | null;
    phone: string;
    defaultAddress: string | null;
    spicePreference: string | null;
    isBlocked: boolean;
  };
  addresses: Array<{
    id: string;
    label: string;
    address: string;
    instructions: string | null;
    isDefault: boolean;
  }>;
  lastOrder: {
    orderNo: string;
    diningType: "takeaway" | "delivery" | "dine_in" | "outdoor";
    grandTotal: number;
    createdAt: string;
    items: Array<{
      itemId: string;
      name: string;
      qty: number;
      price: number;
    }>;
  } | null;
};

export async function lookupCustomerForSelfService(input: {
  branchId: string;
  phone: string;
}): Promise<CustomerSelfServiceLookup | null> {
  const phoneNormalized = normalizePhone(input.phone);
  if (phoneNormalized.length < 8) return null;

  const customerResult = await pgPool.query<{
    id: string;
    name: string | null;
    primary_phone: string;
    default_address: string | null;
    spice_preference: string | null;
    is_blocked: boolean;
  }>(
    `
      select
        c.id,
        c.name,
        c.primary_phone,
        c.default_address,
        c.spice_preference,
        c.is_blocked
      from customers c
      join branches b on b.restaurant_id = c.restaurant_id
      where b.id = $1
        and c.phone_normalized = $2
      limit 1
    `,
    [input.branchId, phoneNormalized],
  );

  const customer = customerResult.rows[0];
  if (!customer) return null;

  const [addressesResult, orderResult] = await Promise.all([
    pgPool.query<{
      id: string;
      label: string;
      address: string;
      instructions: string | null;
      is_default: boolean;
    }>(
      `
        select id, label, address, instructions, is_default
        from customer_addresses
        where customer_id = $1
        order by is_default desc, updated_at desc, created_at desc
        limit 5
      `,
      [customer.id],
    ),
    pgPool.query<{
      id: string;
      order_no: string;
      dining_type: "takeaway" | "delivery" | "dine_in" | "outdoor";
      grand_total: string | number;
      created_at: Date;
    }>(
      `
        select id, order_no, dining_type, grand_total, created_at
        from orders
        where customer_id = $1
          and branch_id = $2
          and status not in ('cancelled', 'voided', 'refunded')
        order by created_at desc
        limit 1
      `,
      [customer.id, input.branchId],
    ),
  ]);

  const latestOrder = orderResult.rows[0];
  const latestItems = latestOrder
    ? await pgPool.query<{
        item_id: string;
        name: string;
        qty: number;
        base_price: string | number;
      }>(
        `
          select
            oi.item_id,
            mi.name,
            oi.qty,
            mi.base_price
          from order_items oi
          join menu_items mi on mi.id = oi.item_id
          where oi.order_id = $1
            and mi.branch_id = $2
            and mi.is_available = true
          order by oi.id
        `,
        [latestOrder.id, input.branchId],
      )
    : null;

  return {
    customer: {
      name: customer.name,
      phone: customer.primary_phone,
      defaultAddress: customer.default_address,
      spicePreference: customer.spice_preference,
      isBlocked: customer.is_blocked,
    },
    addresses: addressesResult.rows.map((address) => ({
      id: address.id,
      label: address.label,
      address: address.address,
      instructions: address.instructions,
      isDefault: address.is_default,
    })),
    lastOrder: latestOrder
      ? {
          orderNo: latestOrder.order_no,
          diningType: latestOrder.dining_type,
          grandTotal: Number(latestOrder.grand_total),
          createdAt: latestOrder.created_at.toISOString(),
          items: (latestItems?.rows ?? []).map((item) => ({
            itemId: item.item_id,
            name: item.name,
            qty: item.qty,
            price: Number(item.base_price),
          })),
        }
      : null,
  };
}

function normalizePhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("0")) return `92${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("3")) return `92${digits}`;
  return digits;
}
