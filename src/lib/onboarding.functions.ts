import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const setupAngaarKitchen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        phone: z.string().max(40).optional(),
        address: z.string().max(240).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const metadata = claims as
      | { user_metadata?: { full_name?: string }; email?: string }
      | undefined;
    const phone = data.phone?.trim() || null;
    const address = data.address?.trim() || "Pakistan";

    const { data: existingRole, error: roleReadError } = await supabaseAdmin
      .from("user_roles")
      .select("restaurant_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    if (roleReadError) throw new Error(roleReadError.message);

    if (existingRole?.restaurant_id) {
      return { restaurantId: existingRole.restaurant_id };
    }

    const { count: restaurantCount, error: countError } = await supabaseAdmin
      .from("restaurants")
      .select("id", { count: "exact", head: true });
    if (countError) throw new Error(countError.message);
    if ((restaurantCount ?? 0) > 0) {
      throw new Error(
        "Operational setup is restricted. Ask an owner or admin to create your staff account.",
      );
    }

    const { data: restaurant, error: restaurantError } = await supabaseAdmin
      .from("restaurants")
      .insert({
        owner_id: userId,
        name: "Angaar Kitchen",
        legal_name: "Angaar Kitchen",
        currency: "PKR",
        currency_symbol: "₨",
        timezone: "Asia/Karachi",
        phone,
        address,
      })
      .select("id")
      .single();
    if (restaurantError) throw new Error(restaurantError.message);

    const { data: branch, error: branchError } = await supabaseAdmin
      .from("branches")
      .insert({
        restaurant_id: restaurant.id,
        name: "Angaar Kitchen",
        code: "AK",
        phone,
        address,
      })
      .select("id")
      .single();
    if (branchError) throw new Error(branchError.message);

    const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
      id: userId,
      full_name: String(
        metadata?.user_metadata?.full_name || metadata?.email || "Angaar Kitchen user",
      ),
      phone,
    });
    if (profileError) throw new Error(profileError.message);

    const { error: ownerRoleError } = await supabaseAdmin.from("user_roles").insert({
      user_id: userId,
      restaurant_id: restaurant.id,
      role: "owner",
      branch_id: null,
    });
    if (ownerRoleError) throw new Error(ownerRoleError.message);

    const { error: branchRoleError } = await supabaseAdmin.from("user_roles").insert({
      user_id: userId,
      restaurant_id: restaurant.id,
      role: "manager",
      branch_id: branch.id,
    });
    if (branchRoleError) throw new Error(branchRoleError.message);

    const { error: hoursError } = await supabaseAdmin.from("operating_hours").insert(
      Array.from({ length: 7 }).map((_, weekday) => ({
        branch_id: branch.id,
        weekday,
        open_time: "12:00",
        close_time: "23:30",
        is_closed: false,
      })),
    );
    if (hoursError) throw new Error(hoursError.message);

    const { error: taxError } = await supabaseAdmin.from("taxes").insert({
      restaurant_id: restaurant.id,
      name: "GST",
      rate: 15,
      is_inclusive: false,
      apply_by_default: true,
    });
    if (taxError) throw new Error(taxError.message);

    return { restaurantId: restaurant.id };
  });
