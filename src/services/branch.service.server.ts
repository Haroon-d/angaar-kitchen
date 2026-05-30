import { eq } from "drizzle-orm";
import { db } from "@/db/client.server";
import { branches, operatingHours } from "@/db/schema";
import { ADMIN_ROLES, requireRestaurantRole } from "@/services/authorization.service.server";

type BranchInput = {
  name: string;
  code: string;
  address?: string | null;
  phone?: string | null;
  isActive: boolean;
};

export async function createBranch(input: BranchInput & { actorId: string; restaurantId: string }) {
  await requireRestaurantRole(input.actorId, input.restaurantId, ADMIN_ROLES);

  const values = normalizeBranchInput(input);

  return db.transaction(async (tx) => {
    const [branch] = await tx
      .insert(branches)
      .values({
        restaurantId: input.restaurantId,
        ...values,
      })
      .returning();

    await tx.insert(operatingHours).values(
      Array.from({ length: 7 }, (_, weekday) => ({
        branchId: branch.id,
        weekday,
        openTime: "10:00",
        closeTime: "22:00",
        isClosed: false,
      })),
    );

    return branch;
  });
}

export async function updateBranch(actorId: string, branchId: string, input: Partial<BranchInput>) {
  const existing = await getBranchOrThrow(branchId);
  await requireRestaurantRole(actorId, existing.restaurantId, ADMIN_ROLES);

  const [branch] = await db
    .update(branches)
    .set({
      ...normalizeBranchPatch(input),
      updatedAt: new Date(),
    })
    .where(eq(branches.id, branchId))
    .returning();

  return branch;
}

export async function deleteBranch(actorId: string, branchId: string) {
  const existing = await getBranchOrThrow(branchId);
  await requireRestaurantRole(actorId, existing.restaurantId, ADMIN_ROLES);

  await db.delete(branches).where(eq(branches.id, branchId));
  return { id: branchId };
}

async function getBranchOrThrow(branchId: string) {
  const [branch] = await db.select().from(branches).where(eq(branches.id, branchId)).limit(1);
  if (!branch) {
    throw new Error("Branch was not found.");
  }

  return branch;
}

function normalizeBranchInput(input: BranchInput) {
  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();

  if (name.length < 2 || name.length > 80) {
    throw new Error("Branch name must be between 2 and 80 characters.");
  }
  if (!/^[A-Z0-9]{1,8}$/.test(code)) {
    throw new Error("Branch code must be 1-8 uppercase letters or numbers.");
  }

  return {
    name,
    code,
    address: normalizeOptionalText(input.address, 200),
    phone: normalizeOptionalText(input.phone, 40),
    isActive: input.isActive,
  };
}

function normalizeBranchPatch(input: Partial<BranchInput>) {
  const patch: Partial<ReturnType<typeof normalizeBranchInput>> = {};

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 80) {
      throw new Error("Branch name must be between 2 and 80 characters.");
    }
    patch.name = name;
  }

  if (input.code !== undefined) {
    const code = input.code.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,8}$/.test(code)) {
      throw new Error("Branch code must be 1-8 uppercase letters or numbers.");
    }
    patch.code = code;
  }

  if (input.address !== undefined) {
    patch.address = normalizeOptionalText(input.address, 200);
  }

  if (input.phone !== undefined) {
    patch.phone = normalizeOptionalText(input.phone, 40);
  }

  if (input.isActive !== undefined) {
    patch.isActive = input.isActive;
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
