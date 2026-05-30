import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db/client.server";
import {
  branches,
  operatingHours,
  profiles,
  restaurants,
  taxes,
  userRoles,
  users,
} from "@/db/schema";

type SetupInitialRestaurantInput = {
  userId: string;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
};

export async function setupInitialRestaurant(input: SetupInitialRestaurantInput) {
  const phone = normalizeOptionalText(input.phone, 40);
  const address = normalizeOptionalText(input.address, 240) ?? "Pakistan";

  return db.transaction(async (tx) => {
    const [existingRole] = await tx
      .select({ restaurantId: userRoles.restaurantId })
      .from(userRoles)
      .where(eq(userRoles.userId, input.userId))
      .orderBy(asc(userRoles.createdAt))
      .limit(1);

    if (existingRole?.restaurantId) {
      return { restaurantId: existingRole.restaurantId };
    }

    const [user] = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);

    if (!user) {
      throw new Error("User account was not found.");
    }

    const [restaurantCount] = await tx.select({ value: count() }).from(restaurants);
    if ((restaurantCount?.value ?? 0) > 0) {
      throw new Error(
        "Operational setup is restricted. Ask an owner or admin to create your staff account.",
      );
    }

    const profileName = normalizeProfileName(input.fullName ?? input.email ?? user.email);
    const [restaurant] = await tx
      .insert(restaurants)
      .values({
        ownerId: input.userId,
        name: "Angaar Kitchen",
        legalName: "Angaar Kitchen",
        currency: "PKR",
        currencySymbol: "Rs",
        timezone: "Asia/Karachi",
        phone,
        address,
      })
      .returning();

    const [branch] = await tx
      .insert(branches)
      .values({
        restaurantId: restaurant.id,
        name: "Angaar Kitchen",
        code: "AK",
        phone,
        address,
      })
      .returning();

    await tx
      .insert(profiles)
      .values({
        id: input.userId,
        fullName: profileName,
        phone,
      })
      .onConflictDoUpdate({
        target: profiles.id,
        set: {
          fullName: profileName,
          phone,
          updatedAt: new Date(),
        },
      });

    await tx.insert(userRoles).values([
      {
        userId: input.userId,
        restaurantId: restaurant.id,
        branchId: null,
        role: "owner",
      },
      {
        userId: input.userId,
        restaurantId: restaurant.id,
        branchId: branch.id,
        role: "manager",
      },
    ]);

    await tx.insert(operatingHours).values(
      Array.from({ length: 7 }, (_, weekday) => ({
        branchId: branch.id,
        weekday,
        openTime: "12:00",
        closeTime: "23:30",
        isClosed: false,
      })),
    );

    await tx.insert(taxes).values({
      restaurantId: restaurant.id,
      name: "GST",
      rate: "15",
      isInclusive: false,
      applyByDefault: true,
    });

    return {
      restaurantId: restaurant.id,
      branchId: branch.id,
    };
  });
}

function normalizeOptionalText(value: string | null | undefined, maxLength: number) {
  const normalized = value?.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new Error(`Value must be ${maxLength} characters or fewer.`);
  }

  return normalized;
}

function normalizeProfileName(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || "Angaar Kitchen user";
}
