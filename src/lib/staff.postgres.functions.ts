import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePostgresAuth } from "@/integrations/postgres/auth-middleware";
import {
  createStaffUser,
  listRestaurantStaff,
  resetStaffPassword,
  STAFF_ROLES,
  type StaffRole,
} from "@/services/staff.service.server";

const CreateStaffSchema = z.object({
  restaurantId: z.string().uuid(),
  branchId: z.string().uuid().nullable().optional(),
  fullName: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  role: z.enum(STAFF_ROLES),
});

const ListStaffSchema = z.object({
  restaurantId: z.string().uuid(),
});
const ResetStaffPasswordSchema = z.object({
  restaurantId: z.string().uuid(),
  targetUserId: z.string().uuid(),
  password: z.string().min(8).max(128),
});

export const createStaffAccountPostgres = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => CreateStaffSchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);

    return createStaffUser({
      actorId: auth.userId,
      restaurantId: data.restaurantId,
      branchId: data.branchId,
      fullName: data.fullName,
      email: data.email,
      password: data.password,
      role: data.role as StaffRole,
    });
  });

export const listRestaurantStaffPostgres = createServerFn({ method: "GET" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => ListStaffSchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    const staff = await listRestaurantStaff(auth.userId, data.restaurantId);

    return staff.map((row) => ({
      id: row.roleId,
      user_id: row.userId,
      full_name: row.fullName,
      email: row.email,
      role: row.role,
      branch_id: row.branchId,
      branch_name: row.branchName,
      is_active: row.isActive,
      created_at: row.createdAt.toISOString(),
    }));
  });

export const resetStaffPasswordPostgres = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => ResetStaffPasswordSchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    await resetStaffPassword({
      actorId: auth.userId,
      restaurantId: data.restaurantId,
      targetUserId: data.targetUserId,
      password: data.password,
    });
    return { ok: true };
  });

function requireAuthContext(context: { userId: string } | undefined) {
  if (!context) {
    throw new Response("Unauthorized", { status: 401 });
  }

  return context;
}
