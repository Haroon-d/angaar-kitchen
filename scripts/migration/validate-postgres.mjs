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

const client = new Client({
  connectionString: requireEnv("DATABASE_URL", "Set this to the PostgreSQL database to validate."),
});

const manifest = readJson(manifestPath);
const authUsers = readJson(join(snapshotDir, "auth_users.json"));
const expectedCounts = {
  users: authUsers.length,
  ...manifest.tables,
};

await client.connect();

try {
  let failures = 0;
  for (const table of IMPORT_TABLES) {
    const expected = expectedCounts[table] ?? 0;
    const actual = await countRows(table);
    const status = actual === expected ? "ok" : "mismatch";
    console.log(`${status.padEnd(8)} ${table.padEnd(34)} expected=${expected} actual=${actual}`);
    if (actual !== expected) failures += 1;
  }

  if (failures > 0) {
    throw new Error(`${failures} table count validation check(s) failed.`);
  }

  console.log("PostgreSQL row-count validation passed.");
} finally {
  await client.end();
}

async function countRows(table) {
  const { rows } = await client.query(`select count(*)::int as count from ${quoteIdent(table)}`);
  return rows[0].count;
}

function quoteIdent(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}
