import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import {
  IMPORT_TABLES,
  loadDotEnv,
  parseArgs,
  projectRootFromMeta,
  readJson,
  requireEnv,
} from "./shared.mjs";

const { Client } = pg;

const rootDir = projectRootFromMeta(import.meta.url);
loadDotEnv(rootDir);

const args = parseArgs(process.argv.slice(2));
const snapshotDir = args.dir ? resolve(rootDir, String(args.dir)) : null;
const shouldCommit = args.commit === true;

if (!snapshotDir) {
  throw new Error("Pass the exported snapshot directory with --dir migration-data/<timestamp>.");
}

const manifestPath = join(snapshotDir, "manifest.json");
if (!existsSync(manifestPath)) {
  throw new Error(`No manifest.json found in ${snapshotDir}.`);
}

const client = new Client({
  connectionString: requireEnv("DATABASE_URL", "Set this to the target PostgreSQL database."),
});

const manifest = readJson(manifestPath);
const authUsers = readJson(join(snapshotDir, "auth_users.json"));
const tableRows = Object.fromEntries(
  IMPORT_TABLES.filter((table) => table !== "users").map((table) => [
    table,
    readJson(join(snapshotDir, "tables", `${table}.json`)),
  ]),
);

await client.connect();

try {
  await client.query("begin");

  await upsertRows("users", authUsers.map(toPostgresUser));
  for (const table of IMPORT_TABLES) {
    if (table === "users") continue;
    if (table === "orders") {
      await deleteConflictingOrders(tableRows.orders);
    }
    await upsertRows(table, tableRows[table]);
  }

  if (shouldCommit) {
    await client.query("commit");
    console.log("Merge import committed to PostgreSQL.");
  } else {
    await client.query("rollback");
    console.log("Dry-run merge succeeded and was rolled back. Re-run with --commit to write.");
  }

  console.log(`Snapshot exported at ${manifest.exportedAt}`);
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

async function upsertRows(table, rows) {
  if (!rows.length) {
    console.log(`${table} <- 0 rows`);
    return;
  }

  const conflictColumns = primaryKeyColumns(table);
  const batchSize = batchSizeFor(rows[0]);
  const columns = Object.keys(rows[0]);
  for (const row of rows) {
    assertSameColumns(table, columns, row);
  }

  const columnSql = columns.map(quoteIdent).join(", ");
  const conflictSql = conflictColumns.map(quoteIdent).join(", ");
  const updateColumns = columns.filter((column) => !conflictColumns.includes(column));
  const updateSql = updateColumns.length
    ? `do update set ${updateColumns
        .map((column) => `${quoteIdent(column)} = ${updateExpression(table, column)}`)
        .join(", ")}`
    : "do nothing";

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values = [];
    const valueGroups = batch.map((row, rowIndex) => {
      const placeholders = columns.map((column, columnIndex) => {
        values.push(row[column]);
        return `$${rowIndex * columns.length + columnIndex + 1}`;
      });

      return `(${placeholders.join(", ")})`;
    });

    const sql = `
      insert into ${quoteIdent(table)} (${columnSql})
      values ${valueGroups.join(", ")}
      on conflict (${conflictSql}) ${updateSql}
    `;
    await client.query(sql, values);
  }

  console.log(`${table} <- merged ${rows.length} rows`);
}

async function deleteConflictingOrders(orders) {
  if (!orders.length) return;

  const orderNumbers = orders.map((order) => order.order_no).filter(Boolean);
  const orderIds = orders.map((order) => order.id).filter(Boolean);
  if (!orderNumbers.length || !orderIds.length) return;

  const { rowCount } = await client.query(
    `
      delete from orders
      where order_no = any($1::text[])
        and not (id = any($2::uuid[]))
    `,
    [orderNumbers, orderIds],
  );

  if (rowCount > 0) {
    console.log(`orders <- removed ${rowCount} conflicting preview row(s) by order_no`);
  }
}

function primaryKeyColumns(table) {
  const composite = {
    item_addon_groups: ["item_id", "group_id"],
    order_counters: ["branch_id", "counter_date"],
    branch_printer_settings: ["branch_id"],
  };

  return composite[table] ?? ["id"];
}

function updateExpression(table, column) {
  if (
    (table === "menu_items" || table === "menu_categories") &&
    column === "image_url"
  ) {
    return `coalesce(excluded.${quoteIdent(column)}, ${quoteIdent(table)}.${quoteIdent(column)})`;
  }

  return `excluded.${quoteIdent(column)}`;
}

function batchSizeFor(row) {
  const columnCount = Object.keys(row).length || 1;
  return Math.max(1, Math.floor(30000 / columnCount));
}

function toPostgresUser(user) {
  if (!user.email) {
    throw new Error(`Auth user ${user.id} has no email and cannot be migrated to app users.`);
  }

  const now = new Date().toISOString();
  const createdAt = user.created_at ?? now;

  return {
    id: user.id,
    email: user.email.trim().toLowerCase(),
    email_verified_at: user.email_verified_at,
    is_active: user.is_active ?? true,
    created_at: createdAt,
    updated_at: user.updated_at ?? createdAt,
  };
}

function assertSameColumns(table, columns, row) {
  const rowColumns = Object.keys(row);
  if (
    rowColumns.length !== columns.length ||
    rowColumns.some((column) => !columns.includes(column))
  ) {
    throw new Error(`Inconsistent columns while importing ${table}.`);
  }
}

function quoteIdent(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}
