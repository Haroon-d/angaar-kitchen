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

if (!snapshotDir) {
  throw new Error("Pass the exported snapshot directory with --dir migration-data/<timestamp>.");
}

const manifestPath = join(snapshotDir, "manifest.json");
if (!existsSync(manifestPath)) {
  throw new Error(`No manifest.json found in ${snapshotDir}.`);
}

const manifest = readJson(manifestPath);
const authUsers = readJson(join(snapshotDir, "auth_users.json"));
const expectedCounts = {
  users: authUsers.length,
  ...manifest.tables,
};

const allowedExtraTables = new Set([
  "users",
  "profiles",
  "user_roles",
  "operating_hours",
  "audit_log",
]);

const client = new Client({
  connectionString: requireEnv("DATABASE_URL", "Set this to the PostgreSQL database to validate."),
});

await client.connect();

try {
  let failures = 0;
  for (const table of IMPORT_TABLES) {
    const expected = expectedCounts[table] ?? 0;
    const actual = await countRows(table);
    const allowsExtra = allowedExtraTables.has(table);
    const passed = allowsExtra ? actual >= expected : actual === expected;
    const mode = allowsExtra ? "minimum" : "exact";
    const status = passed ? "ok" : "mismatch";
    console.log(
      `${status.padEnd(8)} ${table.padEnd(34)} ${mode}=${expected} actual=${actual}`,
    );
    if (!passed) failures += 1;
  }

  await assertNoStaleDeliveryChargeMenuItems();

  if (failures > 0) {
    throw new Error(`${failures} cutover validation check(s) failed.`);
  }

  console.log("PostgreSQL cutover validation passed.");
} finally {
  await client.end();
}

async function countRows(table) {
  const { rows } = await client.query(`select count(*)::int as count from ${quoteIdent(table)}`);
  return rows[0].count;
}

async function assertNoStaleDeliveryChargeMenuItems() {
  const { rows } = await client.query(`
    select count(*)::int as count
    from menu_items mi
    left join menu_categories mc on mc.id = mi.category_id
    where mi.name ~* '\\m(delivery\\s*charges?|delivery\\s*fees?)\\M'
      or coalesce(mc.name, '') ~* '\\mdelivery\\M'
  `);

  if (rows[0].count > 0) {
    throw new Error(`Stale delivery charge menu items remain: ${rows[0].count}`);
  }

  console.log("ok       no stale delivery charge menu items");
}

function quoteIdent(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}
