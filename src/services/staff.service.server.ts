import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client.server";
import { branches, passwordCredentials, profiles, sessions, userRoles, users } from "@/db/schema";
import { hashPassword, normalizeEmail } from "@/services/auth.service.server";
import {
  ADMIN_ROLES,
  requireRestaurantRole,
  type AppRole,
} from "@/services/authorization.service.server";

export const STAFF_ROLES = ["admin", "manager", "cashier", "kitchen", "waiter"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

type CreateStaffUserInput = {
  actorId: string;
  restaurantId: string;
  branchId?: string | null;
  fullName: string;
  email: string;
  password: string;
  role: StaffRole;
};

export async function createStaffUser(input: CreateStaffUserInput) {
  const fullName = normalizeName(input.fullName);
  const email = normalizeEmail(input.email);
  const role = assertStaffRole(input.role);
  const branchId = getRoleBranchId(role, input.branchId);

  await requireRestaurantRole(input.actorId, input.restaurantId, ADMIN_ROLES);
  await assertEmailAvailable(email);
  if (branchId) {
    await assertBranchBelongsToRestaurant(branchId, input.restaurantId);
  }

  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email,
        emailVerifiedAt: new Date(),
      })
      .returning();

    await tx.insert(passwordCredentials).values({
      userId: user.id,
      passwordHash,
    });

    await tx.insert(profiles).values({
      id: user.id,
      fullName,
    });

    const [userRole] = await tx
      .insert(userRoles)
      .values({
        userId: user.id,
        restaurantId: input.restaurantId,
        branchId,
        role,
      })
      .returning();

    return {
      userId: user.id,
      roleId: userRole.id,
    };
  });
}

export async function listRestaurantStaff(actorId: string, restaurantId: string) {
  await requireRestaurantRole(actorId, restaurantId, ADMIN_ROLES);

  return db
    .select({
      roleId: userRoles.id,
      userId: users.id,
      fullName: profiles.fullName,
      email: users.email,
      role: userRoles.role,
      branchId: userRoles.branchId,
      branchName: branches.name,
      isActive: users.isActive,
      createdAt: userRoles.createdAt,
    })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .leftJoin(profiles, eq(profiles.id, users.id))
    .leftJoin(branches, eq(branches.id, userRoles.branchId))
    .where(eq(userRoles.restaurantId, restaurantId))
    .orderBy(asc(userRoles.createdAt));
}

export async function resetStaffPassword(input: {
  actorId: string;
  restaurantId: string;
  targetUserId: string;
  password: string;
}) {
  await requireRestaurantRole(input.actorId, input.restaurantId, ADMIN_ROLES);

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(
      and(
        eq(users.id, input.targetUserId),
        eq(users.isActive, true),
        eq(userRoles.restaurantId, input.restaurantId),
      ),
    )
    .limit(1);
  if (!target) {
    throw new Error("Active staff account was not found in this restaurant.");
  }

  const passwordHash = await hashPassword(input.password);
  await db.transaction(async (tx) => {
    await tx
      .insert(passwordCredentials)
      .values({ userId: target.id, passwordHash, passwordChangedAt: new Date() })
      .onConflictDoUpdate({
        target: passwordCredentials.userId,
        set: { passwordHash, passwordChangedAt: new Date() },
      });
    await tx.delete(sessions).where(eq(sessions.userId, target.id));
  });
}

async function assertEmailAvailable(email: string) {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) {
    throw new Error("A user with this email already exists.");
  }
}

async function assertBranchBelongsToRestaurant(branchId: string, restaurantId: string) {
  const [branch] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.restaurantId, restaurantId)))
    .limit(1);

  if (!branch) {
    throw new Error("Selected branch does not belong to this restaurant.");
  }
}

function getRoleBranchId(role: StaffRole, branchId: string | null | undefined) {
  if (role === "admin") return null;
  if (!branchId) {
    throw new Error("Select a branch for this staff role.");
  }

  return branchId;
}

function assertStaffRole(role: AppRole): StaffRole {
  if (!STAFF_ROLES.includes(role as StaffRole)) {
    throw new Error("Invalid staff role.");
  }

  return role as StaffRole;
}

function normalizeName(name: string) {
  const normalized = name.trim();
  if (normalized.length < 2 || normalized.length > 80) {
    throw new Error("Full name must be between 2 and 80 characters.");
  }

  return normalized;
}
