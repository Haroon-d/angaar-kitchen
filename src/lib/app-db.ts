import { POSTGRES_SESSION_STORAGE_KEY } from "@/integrations/postgres/auth-middleware";
import { supabase } from "@/integrations/supabase/client";
import { isPostgresAuthEnabled } from "@/lib/auth-backend";
import {
  postgresDelete,
  postgresInsert,
  postgresRpc,
  postgresSelect,
  postgresUpdate,
  postgresUpsert,
} from "@/lib/postgres-data.functions";

type QueryError = { message: string };
type QueryResult<T = any> = { data: T | null; error: QueryError | null; count?: number | null };
type Filter = {
  op: "eq" | "neq" | "gte" | "lte" | "lt" | "gt" | "in";
  column: string;
  value: unknown;
};
type Order = { column: string; ascending: boolean };

type AppDbQuery<T = any> = PromiseLike<QueryResult<T>> & {
  select(columns?: string, options?: { count?: "exact"; head?: boolean }): AppDbQuery<T>;
  insert(values: unknown): AppDbQuery<T>;
  update(values: unknown): AppDbQuery<T>;
  delete(): AppDbQuery<T>;
  upsert(values: unknown, options?: { onConflict?: string }): AppDbQuery<T>;
  eq(column: string, value: unknown): AppDbQuery<T>;
  neq(column: string, value: unknown): AppDbQuery<T>;
  gte(column: string, value: unknown): AppDbQuery<T>;
  lte(column: string, value: unknown): AppDbQuery<T>;
  lt(column: string, value: unknown): AppDbQuery<T>;
  gt(column: string, value: unknown): AppDbQuery<T>;
  in(column: string, value: unknown[]): AppDbQuery<T>;
  order(column: string, options?: { ascending?: boolean }): AppDbQuery<T>;
  limit(value: number): AppDbQuery<T>;
  single(): AppDbQuery<T>;
  maybeSingle(): AppDbQuery<T>;
};

type AppDbClient = {
  from(table: string): AppDbQuery;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<QueryResult>;
};

export const appDb: AppDbClient = {
  from(table: string) {
    return isPostgresAuthEnabled()
      ? new PostgresQuery(table)
      : (supabase.from(table as never) as unknown as AppDbQuery);
  },
  rpc(fn: string, args: Record<string, unknown> = {}) {
    if (!isPostgresAuthEnabled()) {
      return supabase.rpc(fn as never, args as never) as unknown as PromiseLike<QueryResult>;
    }
    return withResult(() => postgresRpc({ data: { fn, args }, headers: authHeaders() }));
  },
};

class PostgresQuery implements PromiseLike<QueryResult> {
  private action: "select" | "insert" | "update" | "delete" | "upsert" | null = null;
  private columns = "*";
  private filters: Filter[] = [];
  private orders: Order[] = [];
  private values: unknown;
  private returning = false;
  private limitValue: number | undefined;
  private singleMode = false;
  private maybeSingleMode = false;
  private head = false;
  private count = false;
  private conflictColumns: string[] = ["id"];

  constructor(private readonly table: string) {}

  select(columns = "*", options?: { count?: "exact"; head?: boolean }) {
    if (this.action === "insert" || this.action === "update" || this.action === "upsert") {
      this.returning = true;
      this.columns = columns;
      return this;
    }
    this.action = "select";
    this.columns = columns;
    this.count = options?.count === "exact";
    this.head = options?.head === true;
    return this;
  }

  insert(values: unknown) {
    this.action = "insert";
    this.values = values;
    return this;
  }

  update(values: unknown) {
    this.action = "update";
    this.values = values;
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  upsert(values: unknown, options?: { onConflict?: string }) {
    this.action = "upsert";
    this.values = values;
    this.conflictColumns = options?.onConflict?.split(",").map((column) => column.trim()) ?? ["id"];
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ op: "eq", column, value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ op: "neq", column, value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ op: "gte", column, value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push({ op: "lte", column, value });
    return this;
  }

  lt(column: string, value: unknown) {
    this.filters.push({ op: "lt", column, value });
    return this;
  }

  gt(column: string, value: unknown) {
    this.filters.push({ op: "gt", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ op: "in", column, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  single() {
    this.singleMode = true;
    return this;
  }

  maybeSingle() {
    this.maybeSingleMode = true;
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<QueryResult> {
    return withResult(async () => {
      if (this.action === "insert") {
        const result = await postgresInsert({
          data: {
            table: this.table,
            values: this.values as never,
            returning: this.returning || this.singleMode,
          },
          headers: authHeaders(),
        });
        return this.singleMode
          ? Array.isArray(result.data)
            ? (result.data[0] ?? null)
            : null
          : result.data;
      }
      if (this.action === "update") {
        const result = await postgresUpdate({
          data: {
            table: this.table,
            values: this.values as Record<string, unknown>,
            filters: this.filters,
            returning: this.returning || this.singleMode,
          },
          headers: authHeaders(),
        });
        return this.singleMode
          ? Array.isArray(result.data)
            ? (result.data[0] ?? null)
            : null
          : result.data;
      }
      if (this.action === "delete") {
        const result = await postgresDelete({
          data: { table: this.table, filters: this.filters },
          headers: authHeaders(),
        });
        return result.data;
      }
      if (this.action === "upsert") {
        const result = await postgresUpsert({
          data: {
            table: this.table,
            values: this.values as never,
            conflictColumns: this.conflictColumns,
            returning: this.returning || this.singleMode,
          },
          headers: authHeaders(),
        });
        return this.singleMode
          ? Array.isArray(result.data)
            ? (result.data[0] ?? null)
            : null
          : result.data;
      }

      const result = await postgresSelect({
        data: {
          table: this.table,
          columns: this.columns,
          filters: this.filters,
          orders: this.orders,
          limit: this.limitValue,
          single: this.singleMode,
          maybeSingle: this.maybeSingleMode,
          head: this.head,
          count: this.count,
        },
        headers: authHeaders(),
      });
      return { data: result.data, count: result.count };
    });
  }
}

async function withResult<T>(fn: () => Promise<T>): Promise<QueryResult<T>> {
  try {
    const data = await fn();
    if (data && typeof data === "object" && "data" in data && "count" in data) {
      const value = data as { data: T | null; count?: number | null };
      return { data: value.data, count: value.count ?? null, error: null };
    }
    return { data, error: null };
  } catch (error) {
    return {
      data: null,
      error: { message: error instanceof Error ? error.message : "PostgreSQL request failed" },
    };
  }
}

export function authHeaders(): Record<string, string> {
  const token =
    typeof window !== "undefined"
      ? window.localStorage.getItem(POSTGRES_SESSION_STORAGE_KEY)
      : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
