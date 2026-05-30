import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePostgresAuth } from "@/integrations/postgres/auth-middleware";
import { setupInitialRestaurant } from "@/services/onboarding.service.server";

const SetupSchema = z.object({
  phone: z.string().max(40).optional(),
  address: z.string().max(240).optional(),
});

export const setupAngaarKitchenPostgres = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .inputValidator((input) => SetupSchema.parse(input))
  .handler(async ({ data, context }) => {
    const auth = requireAuthContext(context);

    return setupInitialRestaurant({
      userId: auth.user.id,
      email: auth.user.email,
      phone: data.phone,
      address: data.address,
    });
  });

function requireAuthContext(
  context:
    | {
        user: { id: string; email: string };
      }
    | undefined,
) {
  if (!context) {
    throw new Response("Unauthorized", { status: 401 });
  }

  return context;
}
