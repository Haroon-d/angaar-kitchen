import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client.server";
import {
  addonGroups,
  addons,
  branches,
  itemAddonGroups,
  itemVariants,
  menuCategories,
  menuItems,
  restaurants,
  taxes,
  userRoles,
} from "@/db/schema";
import { getAccessibleBranches } from "@/services/authorization.service.server";

export async function getUserRestaurantContext(userId: string) {
  const roles = await db
    .select()
    .from(userRoles)
    .where(eq(userRoles.userId, userId))
    .orderBy(asc(userRoles.createdAt));

  const restaurantId = roles[0]?.restaurantId ?? null;
  if (!restaurantId) {
    return {
      roles,
      restaurant: null,
      branches: [],
      activeBranch: null,
    };
  }

  const [restaurant] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);

  const accessibleBranches = await getAccessibleBranches(userId, restaurantId);

  return {
    roles,
    restaurant: restaurant ?? null,
    branches: accessibleBranches,
    activeBranch: accessibleBranches[0] ?? null,
  };
}

export async function getRestaurantBranches(restaurantId: string) {
  return db
    .select()
    .from(branches)
    .where(eq(branches.restaurantId, restaurantId))
    .orderBy(asc(branches.createdAt));
}

export async function getBranchMenuCatalog(
  branchId: string,
  options: {
    activeCategoriesOnly?: boolean;
    availableItemsOnly?: boolean;
  } = {},
) {
  const categoryFilters = [eq(menuCategories.branchId, branchId)];
  if (options.activeCategoriesOnly) {
    categoryFilters.push(eq(menuCategories.isActive, true));
  }

  const itemFilters = [eq(menuItems.branchId, branchId)];
  if (options.availableItemsOnly) {
    itemFilters.push(eq(menuItems.isAvailable, true));
  }

  const [categories, items, groups] = await Promise.all([
    db
      .select()
      .from(menuCategories)
      .where(and(...categoryFilters))
      .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.createdAt)),
    db
      .select()
      .from(menuItems)
      .where(and(...itemFilters))
      .orderBy(asc(menuItems.sortOrder), asc(menuItems.createdAt)),
    db
      .select()
      .from(addonGroups)
      .where(eq(addonGroups.branchId, branchId))
      .orderBy(asc(addonGroups.createdAt)),
  ]);

  const itemIds = items.map((item) => item.id);
  const groupIds = groups.map((group) => group.id);

  const [variants, links, addonRows] = await Promise.all([
    itemIds.length
      ? db
          .select()
          .from(itemVariants)
          .where(inArray(itemVariants.itemId, itemIds))
          .orderBy(asc(itemVariants.sortOrder))
      : [],
    itemIds.length
      ? db.select().from(itemAddonGroups).where(inArray(itemAddonGroups.itemId, itemIds))
      : [],
    groupIds.length ? db.select().from(addons).where(inArray(addons.groupId, groupIds)) : [],
  ]);

  return {
    categories,
    items,
    variants,
    addonGroups: groups,
    addons: addonRows,
    itemAddonGroups: links,
  };
}

export async function getPublicCustomerMenu(branchId?: string) {
  const branchFilter = branchId
    ? and(eq(branches.id, branchId), eq(branches.isActive, true))
    : eq(branches.isActive, true);

  const [row] = await db
    .select({
      branch: branches,
      restaurant: restaurants,
    })
    .from(branches)
    .innerJoin(restaurants, eq(restaurants.id, branches.restaurantId))
    .where(branchFilter)
    .orderBy(asc(branches.createdAt))
    .limit(1);

  if (!row) {
    return {
      branch: null,
      restaurant: null,
      categories: [],
      items: [],
      taxes: [],
    };
  }

  const [catalog, activeTaxes] = await Promise.all([
    getBranchMenuCatalog(row.branch.id, {
      activeCategoriesOnly: true,
      availableItemsOnly: true,
    }),
    db
      .select()
      .from(taxes)
      .where(
        and(
          eq(taxes.restaurantId, row.branch.restaurantId),
          eq(taxes.isActive, true),
          eq(taxes.applyByDefault, true),
        ),
      ),
  ]);

  return {
    branch: row.branch,
    restaurant: row.restaurant,
    categories: catalog.categories,
    items: catalog.items,
    taxes: activeTaxes,
  };
}
