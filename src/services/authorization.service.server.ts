import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db/client.server";
import { branches, userRoles } from "@/db/schema";
import {
  ADMIN_ROLES,
  APP_ROLES,
  MANAGER_ROLES,
  rolesInclude as rolesIncludeSet,
  type AppRole,
} from "@/lib/rbac";

export { ADMIN_ROLES, APP_ROLES, MANAGER_ROLES };
export type { AppRole };

export type UserRole = typeof userRoles.$inferSelect;

export const OPERATIONAL_ROLES = APP_ROLES;

export class AuthorizationError extends Error {
  readonly statusCode = 403;

  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function rolesInclude(
  roles: ReadonlyArray<Pick<UserRole, "role">> | null | undefined,
  allowedRoles: readonly AppRole[],
) {
  return rolesIncludeSet(roles, allowedRoles);
}

export function isAdminRole(roles: ReadonlyArray<Pick<UserRole, "role">> | null | undefined) {
  return rolesInclude(roles, ADMIN_ROLES);
}

export function isManagerRole(roles: ReadonlyArray<Pick<UserRole, "role">> | null | undefined) {
  return rolesInclude(roles, MANAGER_ROLES);
}

export async function getUserRoles(userId: string) {
  return db.select().from(userRoles).where(eq(userRoles.userId, userId));
}

export async function getRestaurantRoles(userId: string, restaurantId: string) {
  return db
    .select()
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.restaurantId, restaurantId)));
}

export async function requireRestaurantRole(
  userId: string,
  restaurantId: string,
  allowedRoles: readonly AppRole[] = OPERATIONAL_ROLES,
) {
  const roles = await getRestaurantRoles(userId, restaurantId);
  if (!rolesInclude(roles, allowedRoles)) {
    throw new AuthorizationError();
  }

  return roles;
}

export async function getBranchRoles(userId: string, branchId: string) {
  const branch = await getBranch(branchId);
  if (!branch) return null;

  const roles = await db
    .select()
    .from(userRoles)
    .where(
      and(
        eq(userRoles.userId, userId),
        eq(userRoles.restaurantId, branch.restaurantId),
        or(eq(userRoles.branchId, branchId), isNull(userRoles.branchId)),
      ),
    );

  return { branch, roles };
}

export async function requireBranchRole(
  userId: string,
  branchId: string,
  allowedRoles: readonly AppRole[] = OPERATIONAL_ROLES,
) {
  const access = await getBranchRoles(userId, branchId);
  if (!access || !rolesInclude(access.roles, allowedRoles)) {
    throw new AuthorizationError();
  }

  return access;
}

export async function canAccessRestaurant(
  userId: string,
  restaurantId: string,
  allowedRoles: readonly AppRole[] = OPERATIONAL_ROLES,
) {
  const roles = await getRestaurantRoles(userId, restaurantId);
  return rolesInclude(roles, allowedRoles);
}

export async function canAccessBranch(
  userId: string,
  branchId: string,
  allowedRoles: readonly AppRole[] = OPERATIONAL_ROLES,
) {
  const access = await getBranchRoles(userId, branchId);
  return !!access && rolesInclude(access.roles, allowedRoles);
}

export async function getAccessibleBranches(userId: string, restaurantId: string) {
  const roles = await getRestaurantRoles(userId, restaurantId);
  if (!roles.length) return [];

  if (roles.some((role) => role.branchId === null)) {
    return db
      .select()
      .from(branches)
      .where(eq(branches.restaurantId, restaurantId))
      .orderBy(asc(branches.createdAt));
  }

  const branchIds = [...new Set(roles.map((role) => role.branchId).filter(isPresent))];
  if (!branchIds.length) return [];

  return db
    .select()
    .from(branches)
    .where(inArray(branches.id, branchIds))
    .orderBy(asc(branches.createdAt));
}

async function getBranch(branchId: string) {
  const [branch] = await db.select().from(branches).where(eq(branches.id, branchId)).limit(1);
  return branch ?? null;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}
