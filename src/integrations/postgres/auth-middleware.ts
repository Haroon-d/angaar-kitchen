import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getSessionByToken } from "@/services/auth.service.server";

export const POSTGRES_SESSION_STORAGE_KEY = "angaar_postgres_session_token";

export const attachPostgresAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const token =
      typeof window !== "undefined"
        ? window.localStorage.getItem(POSTGRES_SESSION_STORAGE_KEY)
        : null;

    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
);

export const requirePostgresAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const token = getBearerToken();
    const session = await getSessionByToken(token);

    if (!session) {
      throw new Response("Unauthorized: Invalid or expired session", { status: 401 });
    }

    return next({
      context: {
        sessionToken: token,
        session: session.session,
        user: session.user,
        userId: session.user.id,
      },
    });
  },
);

function getBearerToken() {
  const request = getRequest();
  if (!request?.headers) {
    throw new Response("Unauthorized: No request headers available", { status: 401 });
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    throw new Response("Unauthorized: No authorization header provided", { status: 401 });
  }

  if (!authHeader.startsWith("Bearer ")) {
    throw new Response("Unauthorized: Only Bearer tokens are supported", { status: 401 });
  }

  const token = authHeader.replace("Bearer ", "");
  if (!token) {
    throw new Response("Unauthorized: No token provided", { status: 401 });
  }

  return token;
}
