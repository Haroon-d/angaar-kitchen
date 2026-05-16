import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const StaffRole = z.enum(["admin", "manager", "cashier", "kitchen", "waiter"]);

export const createStaffAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        restaurantId: z.string().uuid(),
        branchId: z.string().uuid().nullable().optional(),
        fullName: z.string().min(2).max(80),
        email: z.string().email(),
        password: z.string().min(8).max(72),
        role: StaffRole,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const actorId = context.userId;

    const { data: actorRole, error: actorRoleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", actorId)
      .eq("restaurant_id", data.restaurantId)
      .in("role", ["owner", "admin"])
      .limit(1)
      .maybeSingle();
    if (actorRoleError) throw new Error(actorRoleError.message);
    if (!actorRole) throw new Error("Only owners and admins can create staff accounts.");

    if (data.branchId) {
      const { data: branch, error: branchError } = await supabaseAdmin
        .from("branches")
        .select("id")
        .eq("id", data.branchId)
        .eq("restaurant_id", data.restaurantId)
        .maybeSingle();
      if (branchError) throw new Error(branchError.message);
      if (!branch) throw new Error("Selected branch does not belong to this restaurant.");
    }

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: data.email.trim().toLowerCase(),
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName.trim() },
    });
    if (createError) throw new Error(createError.message);
    const userId = created.user?.id;
    if (!userId) throw new Error("Staff account was not created.");

    const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
      id: userId,
      full_name: data.fullName.trim(),
    });
    if (profileError) throw new Error(profileError.message);

    const roleBranchId = data.role === "admin" ? null : (data.branchId ?? null);
    const { error: roleError } = await supabaseAdmin.from("user_roles").insert({
      user_id: userId,
      restaurant_id: data.restaurantId,
      branch_id: roleBranchId,
      role: data.role,
    });
    if (roleError) throw new Error(roleError.message);

    return { userId };
  });
