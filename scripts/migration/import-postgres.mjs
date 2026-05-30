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
  ROW_COUNT_TABLES,
} from "./shared.mjs";

const { Client } = pg;

const rootDir = projectRootFromMeta(import.meta.url);
loadDotEnv(rootDir);

const args = parseArgs(process.argv.slice(2));
const snapshotDir = args.dir ? resolve(rootDir, String(args.dir)) : null;
const shouldCommit = args.commit === true;
const allowNonEmpty = args.allowNonEmpty === true;

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

  if (!allowNonEmpty) {
    await assertTargetIsEmpty();
  }

  await insertRows("users", authUsers.map(toPostgresUser));
  for (const table of IMPORT_TABLES) {
    if (table === "users") continue;
    await insertRows(table, tableRows[table]);
  }

  if (shouldCommit) {
    await client.query("commit");
    console.log("Import committed to PostgreSQL.");
  } else {
    await client.query("rollback");
    console.log("Dry-run import succeeded and was rolled back. Re-run with --commit to write.");
  }

  console.log(`Snapshot exported at ${manifest.exportedAt}`);
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

async function assertTargetIsEmpty() {
  for (const table of ROW_COUNT_TABLES) {
    const { rows } = await client.query(`select count(*)::int as count from ${quoteIdent(table)}`);
    if (rows[0].count > 0) {
      throw new Error(
        `Target table ${table} is not empty. Use a fresh migrated database, or pass --allow-non-empty intentionally.`,
      );
    }
  }
}

async function insertRows(table, rows) {
  if (!rows.length) {
    console.log(`${table} <- 0 rows`);
    return;
  }

  const columns = Object.keys(rows[0]);
  const columnSql = columns.map(quoteIdent).join(", ");
  const valueSql = columns.map((_, index) => `$${index + 1}`).join(", ");
  const sql = `insert into ${quoteIdent(table)} (${columnSql}) values (${valueSql})`;

  for (const row of rows) {
    assertSameColumns(table, columns, row);
    await client.query(
      sql,
      columns.map((column) => row[column]),
    );
  }

  console.log(`${table} <- ${rows.length} rows`);
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
