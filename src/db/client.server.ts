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

export const pgPool =
  globalForDb.__angaarPgPool ??
  new Pool({
    connectionString,
    max: 10,
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
