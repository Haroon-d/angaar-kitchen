import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePostgresAuth } from "@/integrations/postgres/auth-middleware";
import {
  createMenuCategory,
  createMenuItem,
  deleteMenuItem,
  listMenuCategories,
  listMenuItems,
  updateMenuCategory,
  updateMenuItem,
} from "@/services/menu.service.server";

const CategorySchema = z.object({
  branchId: z.string().uuid(),
  name: z.string().min(1).max(60),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});

const CategoryUpdateSchema = CategorySchema.omit({ branchId: true }).partial().extend({
  categoryId: z.string().uuid(),
});

const ItemSchema = z.object({
  branchId: z.string().uuid(),
  categoryId: z.string().uuid(),
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional().nullable(),
  imageUrl: z.string().url().optional().nullable(),
  basePrice: z.number().min(0),
  isAvailable: z.boolean(),
  isVeg: z.boolean().optional().nullable(),
  prepTimeMin: z.number().int().min(0).max(240),
});

const ItemUpdateSchema = ItemSchema.omit({ branchId: true }).partial().extend({
  itemId: z.string().uuid(),
});

const BranchMenuSchema = z.object({
  branchId: z.string().uuid(),
  categoryId: z.string().uuid().nullable().optional(),
});

const DeleteItemSchema = z.object({
  itemId: z.string().uuid(),
});

export const listMenuCategoriesPostgres = createServerFn({ method: "GET" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => BranchMenuSchema.pick({ branchId: true }).parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    const categories = await listMenuCategories(auth.userId, data.branchId);
    return categories.map(serializeCategory);
  });

export const listMenuItemsPostgres = createServerFn({ method: "GET" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => BranchMenuSchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    const items = await listMenuItems(auth.userId, data.branchId, {
      categoryId: data.categoryId,
    });
    return items.map(serializeItem);
  });

export const createMenuCategoryPostgres = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => CategorySchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    const category = await createMenuCategory(auth.userId, data.branchId, {
      name: data.name,
      sortOrder: data.sortOrder,
      isActive: data.isActive,
    });
    return serializeCategory(category);
  });

export const updateMenuCategoryPostgres = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => CategoryUpdateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    const category = await updateMenuCategory(auth.userId, data.categoryId, {
      name: data.name,
      sortOrder: data.sortOrder,
      isActive: data.isActive,
    });
    return serializeCategory(category);
  });

export const createMenuItemPostgres = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => ItemSchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    const item = await createMenuItem(auth.userId, data.branchId, {
      categoryId: data.categoryId,
      name: data.name,
      description: data.description,
      imageUrl: data.imageUrl,
      basePrice: data.basePrice,
      isAvailable: data.isAvailable,
      isVeg: data.isVeg,
      prepTimeMin: data.prepTimeMin,
    });
    return serializeItem(item);
  });

export const updateMenuItemPostgres = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => ItemUpdateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    const item = await updateMenuItem(auth.userId, data.itemId, {
      categoryId: data.categoryId,
      name: data.name,
      description: data.description,
      imageUrl: data.imageUrl,
      basePrice: data.basePrice,
      isAvailable: data.isAvailable,
      isVeg: data.isVeg,
      prepTimeMin: data.prepTimeMin,
    });
    return serializeItem(item);
  });

export const deleteMenuItemPostgres = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => DeleteItemSchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    return deleteMenuItem(auth.userId, data.itemId);
  });

function requireAuthContext(context: { userId: string } | undefined) {
  if (!context) {
    throw new Response("Unauthorized", { status: 401 });
  }

  return context;
}

function serializeCategory(category: {
  id: string;
  branchId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
}) {
  return {
    id: category.id,
    branch_id: category.branchId,
    name: category.name,
    description: category.description,
    image_url: category.imageUrl,
    sort_order: category.sortOrder,
    is_active: category.isActive,
  };
}

function serializeItem(item: {
  id: string;
  categoryId: string;
  branchId: string;
  name: string;
  description: string | null;
  basePrice: string;
  imageUrl: string | null;
  isAvailable: boolean;
  isVeg: boolean | null;
  prepTimeMin: number | null;
  sortOrder: number;
}) {
  return {
    id: item.id,
    category_id: item.categoryId,
    branch_id: item.branchId,
    name: item.name,
    description: item.description,
    base_price: item.basePrice,
    image_url: item.imageUrl,
    is_available: item.isAvailable,
    is_veg: item.isVeg,
    prep_time_min: item.prepTimeMin,
    sort_order: item.sortOrder,
  };
}
