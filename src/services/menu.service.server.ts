import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client.server";
import { menuCategories, menuItems } from "@/db/schema";
import { MANAGER_ROLES, requireBranchRole } from "@/services/authorization.service.server";

type CategoryInput = {
  name: string;
  sortOrder: number;
  isActive: boolean;
};

type ItemInput = {
  categoryId: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  basePrice: number;
  isAvailable: boolean;
  isVeg?: boolean | null;
  prepTimeMin: number;
};

export async function listMenuCategories(actorId: string, branchId: string) {
  await requireBranchRole(actorId, branchId, MANAGER_ROLES);

  return db
    .select()
    .from(menuCategories)
    .where(eq(menuCategories.branchId, branchId))
    .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name));
}

export async function listMenuItems(
  actorId: string,
  branchId: string,
  options: { categoryId?: string | null } = {},
) {
  await requireBranchRole(actorId, branchId, MANAGER_ROLES);

  const filters = [eq(menuItems.branchId, branchId)];
  if (options.categoryId) {
    filters.push(eq(menuItems.categoryId, options.categoryId));
  }

  return db
    .select()
    .from(menuItems)
    .where(and(...filters))
    .orderBy(asc(menuItems.sortOrder), asc(menuItems.name));
}

export async function createMenuCategory(actorId: string, branchId: string, input: CategoryInput) {
  await requireBranchRole(actorId, branchId, MANAGER_ROLES);

  const [category] = await db
    .insert(menuCategories)
    .values({
      branchId,
      ...normalizeCategoryInput(input),
    })
    .returning();

  return category;
}

export async function updateMenuCategory(
  actorId: string,
  categoryId: string,
  input: Partial<CategoryInput>,
) {
  const existing = await getCategoryOrThrow(categoryId);
  await requireBranchRole(actorId, existing.branchId, MANAGER_ROLES);

  const [category] = await db
    .update(menuCategories)
    .set({
      ...normalizeCategoryPatch(input),
      updatedAt: new Date(),
    })
    .where(eq(menuCategories.id, categoryId))
    .returning();

  return category;
}

export async function createMenuItem(actorId: string, branchId: string, input: ItemInput) {
  await requireBranchRole(actorId, branchId, MANAGER_ROLES);
  await assertCategoryBelongsToBranch(input.categoryId, branchId);

  const [item] = await db
    .insert(menuItems)
    .values({
      branchId,
      ...normalizeItemInput(input),
    })
    .returning();

  return item;
}

export async function updateMenuItem(actorId: string, itemId: string, input: Partial<ItemInput>) {
  const existing = await getItemOrThrow(itemId);
  await requireBranchRole(actorId, existing.branchId, MANAGER_ROLES);

  if (input.categoryId) {
    await assertCategoryBelongsToBranch(input.categoryId, existing.branchId);
  }

  const [item] = await db
    .update(menuItems)
    .set({
      ...normalizeItemPatch(input),
      updatedAt: new Date(),
    })
    .where(eq(menuItems.id, itemId))
    .returning();

  return item;
}

export async function deleteMenuItem(actorId: string, itemId: string) {
  const existing = await getItemOrThrow(itemId);
  await requireBranchRole(actorId, existing.branchId, MANAGER_ROLES);

  await db.delete(menuItems).where(eq(menuItems.id, itemId));
  return { id: itemId };
}

async function getCategoryOrThrow(categoryId: string) {
  const [category] = await db
    .select()
    .from(menuCategories)
    .where(eq(menuCategories.id, categoryId))
    .limit(1);
  if (!category) {
    throw new Error("Menu category was not found.");
  }

  return category;
}

async function getItemOrThrow(itemId: string) {
  const [item] = await db.select().from(menuItems).where(eq(menuItems.id, itemId)).limit(1);
  if (!item) {
    throw new Error("Menu item was not found.");
  }

  return item;
}

async function assertCategoryBelongsToBranch(categoryId: string, branchId: string) {
  const [category] = await db
    .select({ id: menuCategories.id })
    .from(menuCategories)
    .where(and(eq(menuCategories.id, categoryId), eq(menuCategories.branchId, branchId)))
    .limit(1);

  if (!category) {
    throw new Error("Selected category does not belong to this branch.");
  }
}

function normalizeCategoryInput(input: CategoryInput) {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 60) {
    throw new Error("Category name must be between 1 and 60 characters.");
  }

  return {
    name,
    sortOrder: input.sortOrder,
    isActive: input.isActive,
  };
}

function normalizeCategoryPatch(input: Partial<CategoryInput>) {
  const patch: Partial<ReturnType<typeof normalizeCategoryInput>> = {};

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 1 || name.length > 60) {
      throw new Error("Category name must be between 1 and 60 characters.");
    }
    patch.name = name;
  }
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
  if (input.isActive !== undefined) patch.isActive = input.isActive;

  return patch;
}

function normalizeItemInput(input: ItemInput) {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 80) {
    throw new Error("Item name must be between 1 and 80 characters.");
  }
  if (input.basePrice < 0) {
    throw new Error("Base price cannot be negative.");
  }
  if (input.prepTimeMin < 0 || input.prepTimeMin > 240) {
    throw new Error("Prep time must be between 0 and 240 minutes.");
  }

  return {
    categoryId: input.categoryId,
    name,
    description: normalizeOptionalText(input.description, 500),
    imageUrl: normalizeOptionalText(input.imageUrl, 2000),
    basePrice: input.basePrice.toFixed(2),
    isAvailable: input.isAvailable,
    isVeg: input.isVeg ?? null,
    prepTimeMin: input.prepTimeMin,
  };
}

function normalizeItemPatch(input: Partial<ItemInput>) {
  const patch: Partial<ReturnType<typeof normalizeItemInput>> = {};

  if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 1 || name.length > 80) {
      throw new Error("Item name must be between 1 and 80 characters.");
    }
    patch.name = name;
  }
  if (input.description !== undefined) {
    patch.description = normalizeOptionalText(input.description, 500);
  }
  if (input.imageUrl !== undefined) {
    patch.imageUrl = normalizeOptionalText(input.imageUrl, 2000);
  }
  if (input.basePrice !== undefined) {
    if (input.basePrice < 0) throw new Error("Base price cannot be negative.");
    patch.basePrice = input.basePrice.toFixed(2);
  }
  if (input.isAvailable !== undefined) patch.isAvailable = input.isAvailable;
  if (input.isVeg !== undefined) patch.isVeg = input.isVeg;
  if (input.prepTimeMin !== undefined) {
    if (input.prepTimeMin < 0 || input.prepTimeMin > 240) {
      throw new Error("Prep time must be between 0 and 240 minutes.");
    }
    patch.prepTimeMin = input.prepTimeMin;
  }

  return patch;
}

function normalizeOptionalText(value: string | null | undefined, maxLength: number) {
  const normalized = value?.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new Error(`Value must be ${maxLength} characters or fewer.`);
  }

  return normalized;
}
