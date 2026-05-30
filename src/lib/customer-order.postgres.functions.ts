import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getPublicCustomerMenu } from "@/services/catalog.service.server";
import { createCustomerOrder } from "@/services/order.service.server";

const CustomerItem = z.object({
  itemId: z.string().uuid(),
  qty: z.number().int().min(1).max(50),
  notes: z.string().max(160).optional().nullable(),
});

export const getCustomerMenuPostgres = createServerFn({ method: "GET" }).handler(async () => {
  const menu = await getPublicCustomerMenu();

  if (!menu.branch || !menu.restaurant) {
    return { branch: null, restaurant: null, categories: [], items: [], taxes: [] };
  }

  return {
    branch: {
      id: menu.branch.id,
      name: menu.branch.name,
      address: menu.branch.address,
      phone: menu.branch.phone,
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
      sort_order: item.sortOrder,
    })),
    taxes: menu.taxes.map((tax) => ({
      id: tax.id,
      name: tax.name,
      rate: Number(tax.rate),
      is_inclusive: tax.isInclusive,
    })),
  };
});

export const placeCustomerOrderPostgres = createServerFn({ method: "POST" })
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
  .handler(async ({ data }) => createCustomerOrder(data));
