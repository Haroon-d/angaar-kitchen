import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client.server";
import {
  addonGroups,
  addons,
  branches,
  customerReviews,
  customers,
  homepagePromotions,
  itemAddonGroups,
  itemVariants,
  menuCategories,
  menuItems,
  operatingHours,
  orderItems,
  orders,
  restaurants,
  taxes,
  userRoles,
} from "@/db/schema";
import { getAccessibleBranches } from "@/services/authorization.service.server";

const PUBLIC_MENU_CACHE_TTL_MS = 120_000;

type PublicCustomerMenuResult = Awaited<ReturnType<typeof buildPublicCustomerMenu>>;
const publicMenuCache = new Map<string, { expiresAt: number; value: PublicCustomerMenuResult }>();

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
  const cacheKey = branchId ?? "default";
  const cached = publicMenuCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = await buildPublicCustomerMenu(branchId);
  publicMenuCache.set(cacheKey, {
    expiresAt: Date.now() + PUBLIC_MENU_CACHE_TTL_MS,
    value,
  });
  return value;
}

async function buildPublicCustomerMenu(branchId?: string) {
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
      hours: [],
      live: null,
    };
  }

  const [catalog, activeTaxes, hours, liveRows, promotions, reviewSummaryRows, recentReviews, popularRows] =
    await Promise.all([
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
    db
      .select()
      .from(operatingHours)
      .where(eq(operatingHours.branchId, row.branch.id))
      .orderBy(asc(operatingHours.weekday)),
      db
        .select({
          activeOrders: sql<number>`count(*) filter (where ${orders.status} in ('open', 'placed', 'preparing', 'ready'))::int`,
          todayOrders: sql<number>`count(*) filter (where ${orders.createdAt} >= date_trunc('day', now() at time zone ${row.restaurant.timezone}) at time zone ${row.restaurant.timezone})::int`,
          latestOrderAt: sql<Date | null>`max(${orders.createdAt})`,
        })
        .from(orders)
        .where(eq(orders.branchId, row.branch.id)),
      db
        .select()
        .from(homepagePromotions)
        .where(
          and(
            eq(homepagePromotions.restaurantId, row.restaurant.id),
            eq(homepagePromotions.isActive, true),
            sql`(${homepagePromotions.startDate} is null or ${homepagePromotions.startDate} <= now())`,
            sql`(${homepagePromotions.endDate} is null or ${homepagePromotions.endDate} >= now())`,
          ),
        )
        .orderBy(desc(homepagePromotions.priority), asc(homepagePromotions.createdAt))
        .limit(12),
      db
        .select({
          averageRating: sql<number>`coalesce(avg(${customerReviews.rating}), 0)::float`,
          totalReviews: sql<number>`count(*)::int`,
        })
        .from(customerReviews)
        .where(
          and(
            eq(customerReviews.restaurantId, row.restaurant.id),
            eq(customerReviews.isApproved, true),
          ),
        ),
      db
        .select({
          id: customerReviews.id,
          rating: customerReviews.rating,
          review: customerReviews.review,
          createdAt: customerReviews.createdAt,
          customerName: customers.name,
        })
        .from(customerReviews)
        .innerJoin(customers, eq(customers.id, customerReviews.customerId))
        .where(
          and(
            eq(customerReviews.restaurantId, row.restaurant.id),
            eq(customerReviews.isApproved, true),
          ),
        )
        .orderBy(desc(customerReviews.createdAt))
        .limit(6),
      db
        .select({
          itemId: orderItems.itemId,
          purchases: sql<number>`sum(${orderItems.qty})::int`,
        })
        .from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .where(
          and(
            eq(orders.branchId, row.branch.id),
            sql`${orders.createdAt} >= now() - interval '45 days'`,
            sql`${orderItems.itemId} is not null`,
          ),
        )
        .groupBy(orderItems.itemId)
        .orderBy(sql`sum(${orderItems.qty}) desc`)
        .limit(10),
    ]);
  const todayHours = getTodayHours(hours);
  const reviewSummary = reviewSummaryRows[0] ?? { averageRating: 0, totalReviews: 0 };

  return {
    branch: row.branch,
    restaurant: row.restaurant,
    categories: catalog.categories,
    items: catalog.items,
    taxes: activeTaxes,
    hours,
    promotions,
    reviews: {
      averageRating: Number(reviewSummary.averageRating ?? 0),
      totalReviews: Number(reviewSummary.totalReviews ?? 0),
      recent: recentReviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        review: review.review,
        createdAt: review.createdAt.toISOString(),
        customerName: review.customerName,
        isVerifiedPurchase: true,
      })),
    },
    rankings: {
      mostOrderedItemIds: popularRows
        .map((row) => row.itemId)
        .filter((id): id is string => Boolean(id)),
    },
    live: {
      isOpenNow: isOpenNow(todayHours, row.restaurant.timezone),
      todayHours,
      activeOrders: Number(liveRows[0]?.activeOrders ?? 0),
      todayOrders: Number(liveRows[0]?.todayOrders ?? 0),
      latestOrderAt: liveRows[0]?.latestOrderAt?.toISOString?.() ?? null,
      menuUpdatedAt:
        catalog.items
          .map((item) => item.updatedAt)
          .filter(Boolean)
          .sort((a, b) => b.getTime() - a.getTime())[0]
          ?.toISOString() ?? null,
    },
  };
}

type PublicHoursRow = typeof operatingHours.$inferSelect;

function getTodayHours(hours: PublicHoursRow[]) {
  const weekday = new Date().getDay();
  const today = hours.find((row) => row.weekday === weekday);
  if (!today || today.isClosed || !today.openTime || !today.closeTime) {
    return null;
  }

  return {
    weekday: today.weekday,
    openTime: today.openTime,
    closeTime: today.closeTime,
  };
}

function isOpenNow(
  todayHours: { openTime: string; closeTime: string } | null,
  timeZone: string | null,
) {
  if (!todayHours) return false;

  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone || "Asia/Karachi",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [hour, minute] = formatter.format(new Date()).split(":").map(Number);
  const nowMinutes = hour * 60 + minute;
  const openMinutes = timeToMinutes(todayHours.openTime);
  const closeMinutes = timeToMinutes(todayHours.closeTime);

  if (closeMinutes <= openMinutes) {
    return nowMinutes >= openMinutes || nowMinutes < closeMinutes;
  }

  return nowMinutes >= openMinutes && nowMinutes < closeMinutes;
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
