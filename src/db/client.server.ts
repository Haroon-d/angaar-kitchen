import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required for the PostgreSQL database client.");
}

const globalForDb = globalThis as typeof globalThis & {
  __angaarPgPool?: Pool;
  __angaarPgPoolErrorHandlerAttached?: boolean;
};

function shouldUseSsl(url: string) {
  if (process.env.DATABASE_SSL === "true") return true;
  if (process.env.DATABASE_SSL === "false") return false;

  try {
    return new URL(url).searchParams.get("sslmode") === "require";
  } catch {
    return false;
  }
}

function poolMax() {
  const value = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 10;
}

export const pgPool =
  globalForDb.__angaarPgPool ??
  new Pool({
    connectionString,
    max: poolMax(),
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  });

if (!globalForDb.__angaarPgPoolErrorHandlerAttached) {
  pgPool.on("error", (error) => {
    console.warn("PostgreSQL idle connection error:", error.message);
  });
  globalForDb.__angaarPgPoolErrorHandlerAttached = true;
}

if (process.env.NODE_ENV !== "production") {
  globalForDb.__angaarPgPool = pgPool;
}

export const db = drizzle(pgPool, { schema });
