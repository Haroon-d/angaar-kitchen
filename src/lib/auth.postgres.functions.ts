import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePostgresAuth } from "@/integrations/postgres/auth-middleware";
import {
  authenticateWithPassword,
  createSession,
  revokeSessionToken,
} from "@/services/auth.service.server";
import { getUserRoles } from "@/services/authorization.service.server";

const SignInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const SignUpSchema = z.object({
  fullName: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const signInWithPasswordPostgres = createServerFn({ method: "POST" })
  .inputValidator((input) => SignInSchema.parse(input))
  .handler(async ({ data }) => {
    const user = await authenticateWithPassword(data.email, data.password);
    if (!user) {
      throw new Error("Invalid email or password.");
    }

    const [{ token }, roles] = await Promise.all([createSession(user.id), getUserRoles(user.id)]);

    return {
      token,
      user: serializeUser(user),
      roles: roles.map(serializeRole),
    };
  });

export const signUpWithPasswordPostgres = createServerFn({ method: "POST" })
  .inputValidator((input) => SignUpSchema.parse(input))
  .handler(async () => {
    throw new Error("Public account creation is disabled. Ask an owner or admin to create staff access.");
  });

export const getCurrentUserPostgres = createServerFn({ method: "GET" })
  .middleware([requirePostgresAuth])
  .handler(async ({ context }) => {
    const auth = requireAuthContext(context);
    const roles = await getUserRoles(auth.userId);

    return {
      user: serializeUser(auth.user),
      roles: roles.map(serializeRole),
    };
  });

export const signOutPostgres = createServerFn({ method: "POST" })
  .middleware([requirePostgresAuth])
  .handler(async ({ context }) => {
    const auth = requireAuthContext(context);
    await revokeSessionToken(auth.sessionToken);
    return { ok: true };
  });

function requireAuthContext(
  context:
    | {
        sessionToken: string;
        userId: string;
        user: { id: string; email: string };
      }
    | undefined,
) {
  if (!context) {
    throw new Response("Unauthorized", { status: 401 });
  }

  return context;
}

function serializeUser(user: { id: string; email: string }) {
  return {
    id: user.id,
    email: user.email,
  };
}

function serializeRole(role: {
  id: string;
  role: string;
  restaurantId: string;
  branchId: string | null;
}) {
  return {
    id: role.id,
    role: role.role,
    restaurant_id: role.restaurantId,
    branch_id: role.branchId,
  };
}
