import { createServerFn } from "@tanstack/react-start";
import { requirePostgresAuth } from "@/integrations/postgres/auth-middleware";
import { getUserRestaurantContext } from "@/services/catalog.service.server";

export const getUserRestaurantContextPostgres = createServerFn({ method: "GET" })
  .middleware([requirePostgresAuth])
  .handler(async ({ context }) => {
    const auth = requireAuthContext(context);
    const result = await getUserRestaurantContext(auth.userId);

    return {
      roles: result.roles.map((role) => ({
        id: role.id,
        role: role.role,
        restaurant_id: role.restaurantId,
        branch_id: role.branchId,
      })),
      restaurant: result.restaurant ? serializeRestaurant(result.restaurant) : null,
      branches: result.branches.map(serializeBranch),
      active_branch: result.activeBranch ? serializeBranch(result.activeBranch) : null,
    };
  });

function requireAuthContext(context: { userId: string } | undefined) {
  if (!context) {
    throw new Response("Unauthorized", { status: 401 });
  }

  return context;
}

function serializeRestaurant(restaurant: {
  id: string;
  name: string;
  legalName: string | null;
  logoUrl: string | null;
  currency: string;
  currencySymbol: string;
  timezone: string;
  phone: string | null;
  email: string | null;
  address: string | null;
}) {
  return {
    id: restaurant.id,
    name: restaurant.name,
    legal_name: restaurant.legalName,
    logo_url: restaurant.logoUrl,
    currency: restaurant.currency,
    currency_symbol: restaurant.currencySymbol,
    timezone: restaurant.timezone,
    phone: restaurant.phone,
    email: restaurant.email,
    address: restaurant.address,
  };
}

function serializeBranch(branch: {
  id: string;
  restaurantId: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  deliveryFee: string | number;
  isActive: boolean;
}) {
  return {
    id: branch.id,
    restaurant_id: branch.restaurantId,
    name: branch.name,
    code: branch.code,
    address: branch.address,
    phone: branch.phone,
    delivery_fee: branch.deliveryFee,
    is_active: branch.isActive,
  };
}
