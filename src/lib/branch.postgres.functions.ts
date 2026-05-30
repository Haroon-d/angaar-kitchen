import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePostgresAuth } from "@/integrations/postgres/auth-middleware";
import { createBranch, deleteBranch, updateBranch } from "@/services/branch.service.server";

const BranchSchema = z.object({
  restaurantId: z.string().uuid(),
  name: z.string().min(2).max(80),
  code: z
    .string()
    .min(1)
    .max(8)
    .regex(/^[A-Z0-9]+$/),
  address: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  isActive: z.boolean(),
});

const UpdateBranchSchema = BranchSchema.omit({ restaurantId: true }).partial().extend({
  branchId: z.string().uuid(),
});

const DeleteBranchSchema = z.object({
  branchId: z.string().uuid(),
});

export const createBranchPostgres = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => BranchSchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    const branch = await createBranch({
      actorId: auth.userId,
      restaurantId: data.restaurantId,
      name: data.name,
      code: data.code,
      address: data.address,
      phone: data.phone,
      isActive: data.isActive,
    });

    return serializeBranch(branch);
  });

export const updateBranchPostgres = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => UpdateBranchSchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    const branch = await updateBranch(auth.userId, data.branchId, {
      name: data.name,
      code: data.code,
      address: data.address,
      phone: data.phone,
      isActive: data.isActive,
    });

    return serializeBranch(branch);
  });

export const deleteBranchPostgres = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => DeleteBranchSchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);
    return deleteBranch(auth.userId, data.branchId);
  });

function requireAuthContext(context: { userId: string } | undefined) {
  if (!context) {
    throw new Response("Unauthorized", { status: 401 });
  }

  return context;
}

function serializeBranch(branch: {
  id: string;
  restaurantId: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
}) {
  return {
    id: branch.id,
    restaurant_id: branch.restaurantId,
    name: branch.name,
    code: branch.code,
    address: branch.address,
    phone: branch.phone,
    is_active: branch.isActive,
  };
}
