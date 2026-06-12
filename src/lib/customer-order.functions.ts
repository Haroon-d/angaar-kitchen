import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CustomerItem = z.object({
  itemId: z.string().uuid(),
  qty: z.number().int().min(1).max(50),
  notes: z.string().max(160).optional().nullable(),
});

export const getCustomerMenu = createServerFn({ method: "GET" }).handler(async () => {
  const { data: branch, error: branchError } = await supabaseAdmin
    .from("branches")
    .select(
      "id, name, address, phone, restaurant_id, restaurants(id, name, currency_symbol, address, phone, timezone)",
    )
    .eq("is_active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (branchError) throw new Error(branchError.message);
  if (!branch)
    return { branch: null, restaurant: null, categories: [], items: [], taxes: [], hours: [], live: null };

  const [
    { data: categories, error: categoriesError },
    { data: items, error: itemsError },
    { data: taxes, error: taxesError },
    { data: hours, error: hoursError },
    { data: activeOrders, error: activeOrdersError, count: activeOrdersCount },
    { data: todayOrders, error: todayOrdersError, count: todayOrdersCount },
  ] = await Promise.all([
    supabaseAdmin
      .from("menu_categories")
      .select("id, name, sort_order")
      .eq("branch_id", branch.id)
      .eq("is_active", true)
      .order("sort_order"),
    supabaseAdmin
      .from("menu_items")
      .select("id, category_id, name, description, base_price, image_url, is_available, sort_order")
      .eq("branch_id", branch.id)
      .eq("is_available", true)
      .order("sort_order"),
    supabaseAdmin
      .from("taxes")
      .select("id, name, rate, is_inclusive")
      .eq("restaurant_id", branch.restaurant_id)
      .eq("is_active", true)
      .eq("apply_by_default", true),
    supabaseAdmin
      .from("operating_hours")
      .select("weekday, open_time, close_time, is_closed")
      .eq("branch_id", branch.id)
      .order("weekday"),
    supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("branch_id", branch.id)
      .in("status", ["open", "placed", "preparing", "ready"]),
    supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("branch_id", branch.id)
      .gte("created_at", getLocalDayStart(getRestaurantTimezone(branch.restaurants)).toISOString()),
  ]);
  if (categoriesError) throw new Error(categoriesError.message);
  if (itemsError) throw new Error(itemsError.message);
  if (taxesError) throw new Error(taxesError.message);
  if (hoursError) throw new Error(hoursError.message);
  if (activeOrdersError) throw new Error(activeOrdersError.message);
  if (todayOrdersError) throw new Error(todayOrdersError.message);
  void activeOrders;
  void todayOrders;

  const restaurant = Array.isArray(branch.restaurants) ? branch.restaurants[0] : branch.restaurants;
  const todayHours = getTodayHours(hours ?? []);

  return {
    branch: {
      id: branch.id,
      name: branch.name,
      address: branch.address,
      phone: branch.phone,
    },
    restaurant,
    categories: categories ?? [],
    items: items ?? [],
    taxes: taxes ?? [],
    hours: hours ?? [],
    live: {
      isOpenNow: isOpenNow(todayHours, getRestaurantTimezone(branch.restaurants)),
      todayHours,
      activeOrders: activeOrdersCount ?? 0,
      todayOrders: todayOrdersCount ?? 0,
      latestOrderAt: null,
      menuUpdatedAt: null,
    },
  };
});

export const placeCustomerOrder = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        branchId: z.string().uuid(),
        diningType: z.enum(["takeaway", "delivery"]),
        customerName: z.string().min(2).max(80),
        customerPhone: z.string().min(6).max(40),
        notes: z.string().max(240).optional().nullable(),
        items: z.array(CustomerItem).min(1).max(40),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { data: branch, error: branchError } = await supabaseAdmin
      .from("branches")
      .select("id, code, restaurant_id, is_active")
      .eq("id", data.branchId)
      .maybeSingle();
    if (branchError) throw new Error(branchError.message);
    if (!branch?.is_active) throw new Error("This branch is not accepting orders.");

    const requestedIds = [...new Set(data.items.map((item) => item.itemId))];
    const { data: menuItems, error: menuError } = await supabaseAdmin
      .from("menu_items")
      .select("id, branch_id, name, base_price, is_available")
      .in("id", requestedIds);
    if (menuError) throw new Error(menuError.message);

    const menuById = new Map((menuItems ?? []).map((item) => [item.id, item]));
    let subtotal = 0;
    for (const line of data.items) {
      const item = menuById.get(line.itemId);
      if (!item || item.branch_id !== branch.id || !item.is_available) {
        throw new Error("One or more items are no longer available.");
      }
      subtotal += Number(item.base_price) * line.qty;
    }

    const { data: taxes, error: taxesError } = await supabaseAdmin
      .from("taxes")
      .select("id, name, rate, is_inclusive")
      .eq("restaurant_id", branch.restaurant_id)
      .eq("is_active", true)
      .eq("apply_by_default", true);
    if (taxesError) throw new Error(taxesError.message);

    const taxRows = (taxes ?? []).map((tax) => {
      const rate = Number(tax.rate);
      const amount = tax.is_inclusive
        ? roundMoney(subtotal - subtotal / (1 + rate / 100))
        : roundMoney((subtotal * rate) / 100);
      return { ...tax, rate, amount };
    });
    const taxTotal = taxRows
      .filter((tax) => !tax.is_inclusive)
      .reduce((sum, tax) => sum + tax.amount, 0);
    const grandTotal = roundMoney(subtotal + taxTotal);

    const orderNo = await nextOrderNo(branch.id, branch.code);
    const orderId = randomUUID();

    const { error: orderError } = await supabaseAdmin.from("orders").insert({
      id: orderId,
      branch_id: branch.id,
      order_no: orderNo,
      dining_type: data.diningType,
      status: "placed",
      payment_status: "pending",
      customer_name: data.customerName.trim(),
      customer_phone: data.customerPhone.trim(),
      notes: data.notes?.trim() || null,
      subtotal: roundMoney(subtotal),
      discount_total: 0,
      tax_total: roundMoney(taxTotal),
      grand_total: grandTotal,
      amount_paid: 0,
      idempotency_key: randomUUID(),
    });
    if (orderError) throw new Error(orderError.message);

    const { error: itemsError } = await supabaseAdmin.from("order_items").insert(
      data.items.map((line) => {
        const item = menuById.get(line.itemId)!;
        const qty = line.qty;
        return {
          order_id: orderId,
          item_id: item.id,
          name_snapshot: item.name,
          unit_price: item.base_price,
          qty,
          line_subtotal: roundMoney(Number(item.base_price) * qty),
          notes: line.notes?.trim() || null,
        };
      }),
    );
    if (itemsError) throw new Error(itemsError.message);

    if (taxRows.length) {
      const { error: orderTaxesError } = await supabaseAdmin.from("order_taxes").insert(
        taxRows.map((tax) => ({
          order_id: orderId,
          tax_id: tax.id,
          name_snapshot: tax.name,
          rate_snapshot: tax.rate,
          amount: tax.amount,
        })),
      );
      if (orderTaxesError) throw new Error(orderTaxesError.message);
    }

    await supabaseAdmin.from("audit_log").insert({
      restaurant_id: branch.restaurant_id,
      branch_id: branch.id,
      actor_id: null,
      entity: "order",
      entity_id: orderId,
      action: "customer_placed",
      meta: { order_no: orderNo, grand_total: grandTotal },
    });

    return { orderId, orderNo, grandTotal };
  });

export const lookupCustomerForOrder = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        branchId: z.string().uuid(),
        phone: z.string().min(6).max(40),
      })
      .parse(input),
  )
  .handler(async () => null);

async function nextOrderNo(branchId: string, branchCode: string | null) {
  const { data, error } = await supabaseAdmin.rpc("next_order_number", { _branch: branchId });
  if (error) throw new Error(error.message);
  return (
    data ||
    `AK-${branchCode || "BR"}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 4)}`
  );
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getRestaurantTimezone(restaurants: unknown) {
  const restaurant = Array.isArray(restaurants) ? restaurants[0] : restaurants;
  const timezone = (restaurant as { timezone?: string | null } | null)?.timezone;
  return timezone || "Asia/Karachi";
}

function getTodayHours(
  hours: Array<{
    weekday: number;
    open_time: string | null;
    close_time: string | null;
    is_closed: boolean;
  }>,
) {
  const weekday = new Date().getDay();
  const today = hours.find((row) => row.weekday === weekday);
  if (!today || today.is_closed || !today.open_time || !today.close_time) return null;
  return {
    weekday: today.weekday,
    openTime: today.open_time,
    closeTime: today.close_time,
  };
}

function isOpenNow(
  todayHours: { openTime: string; closeTime: string } | null,
  timeZone: string,
) {
  if (!todayHours) return false;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [hour, minute] = formatter.format(new Date()).split(":").map(Number);
  const nowMinutes = hour * 60 + minute;
  const openMinutes = timeToMinutes(todayHours.openTime);
  const closeMinutes = timeToMinutes(todayHours.closeTime);
  return closeMinutes <= openMinutes
    ? nowMinutes >= openMinutes || nowMinutes < closeMinutes
    : nowMinutes >= openMinutes && nowMinutes < closeMinutes;
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function getLocalDayStart(timeZone: string) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(`${byType.year}-${byType.month}-${byType.day}T00:00:00+05:00`);
}
