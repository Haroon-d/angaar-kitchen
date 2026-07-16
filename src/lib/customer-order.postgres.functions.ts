import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@/db/client.server";
import { productAnalyticsEvents } from "@/db/schema";
import { getPublicCustomerMenu } from "@/services/catalog.service.server";
import { lookupCustomerForSelfService } from "@/services/customer-self-service.server";
import { createCustomerOrder } from "@/services/order.service.server";

const CustomerItem = z.object({
  itemId: z.string().uuid(),
  qty: z.number().int().min(1).max(50),
  notes: z.string().max(160).optional().nullable(),
});

export const getCustomerMenuPostgres = createServerFn({ method: "GET" }).handler(async () => {
  const menu = await getPublicCustomerMenu();

  if (!menu.branch || !menu.restaurant) {
    return { branch: null, restaurant: null, categories: [], items: [], taxes: [], hours: [], live: null };
  }

  return {
    branch: {
      id: menu.branch.id,
      name: menu.branch.name,
      address: menu.branch.address,
      phone: menu.branch.phone,
      delivery_fee: Number(menu.branch.deliveryFee ?? 0),
    },
    restaurant: {
      id: menu.restaurant.id,
      name: menu.restaurant.name,
      currency_symbol: menu.restaurant.currencySymbol,
      address: menu.restaurant.address,
      phone: menu.restaurant.phone,
    },
    categories: menu.categories.map((category) => ({
      id: category.id,
      name: category.name,
      description: category.description,
      image_url: category.imageUrl,
      sort_order: category.sortOrder,
    })),
    items: menu.items.map((item) => ({
      id: item.id,
      category_id: item.categoryId,
      name: item.name,
      description: item.description,
      base_price: Number(item.basePrice),
      image_url: item.imageUrl,
      is_available: item.isAvailable,
      is_best_seller: item.isBestSeller,
      is_chef_recommended: item.isChefRecommended,
      is_popular: item.isPopular,
      is_new_item: item.isNewItem,
      spice_level: item.spiceLevel,
      serving_size: item.servingSize,
      sort_order: item.sortOrder,
    })),
    taxes: menu.taxes.map((tax) => ({
      id: tax.id,
      name: tax.name,
      rate: Number(tax.rate),
      is_inclusive: tax.isInclusive,
    })),
    hours: menu.hours.map((hour) => ({
      weekday: hour.weekday,
      open_time: hour.openTime,
      close_time: hour.closeTime,
      is_closed: hour.isClosed,
    })),
    live: menu.live,
    promotions: menu.promotions.map((promotion) => ({
      id: promotion.id,
      title: promotion.title,
      subtitle: promotion.subtitle,
      description: promotion.description,
      image_url: promotion.imageUrl,
      cta_text: promotion.ctaText,
      cta_link: promotion.ctaLink,
      action_type: promotion.actionType,
      menu_item_id: promotion.menuItemId,
      priority: promotion.priority,
    })),
    reviews: menu.reviews,
    rankings: menu.rankings,
  };
});

export const placeCustomerOrderPostgres = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        branchId: z.string().uuid(),
        diningType: z.enum(["takeaway", "delivery"]),
        customerName: z.string().min(2).max(80),
        customerPhone: z.string().max(40).optional().nullable().default(""),
        notes: z.string().max(240).optional().nullable(),
        couponCode: z.string().max(40).optional().nullable(),
        items: z.array(CustomerItem).min(1).max(40),
      })
      .parse(input),
  )
  .handler(async ({ data }) => createCustomerOrder(data));

export const lookupCustomerForOrderPostgres = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        branchId: z.string().uuid(),
        phone: z.string().min(6).max(40),
      })
      .parse(input),
  )
  .handler(async ({ data }) => lookupCustomerForSelfService(data));

export const trackCustomerCommerceEventPostgres = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        restaurantId: z.string().uuid(),
        branchId: z.string().uuid().optional().nullable(),
        itemId: z.string().uuid().optional().nullable(),
        eventType: z.enum(["product_view", "cart_addition", "search"]),
        searchQuery: z.string().max(120).optional().nullable(),
        sessionId: z.string().max(120).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    await db.insert(productAnalyticsEvents).values({
      restaurantId: data.restaurantId,
      branchId: data.branchId ?? null,
      itemId: data.itemId ?? null,
      eventType: data.eventType,
      searchQuery: data.searchQuery?.trim() || null,
      sessionId: data.sessionId?.trim() || null,
    });
    return { ok: true };
  });
