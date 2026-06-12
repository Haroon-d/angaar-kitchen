import { join, resolve } from "node:path";
import pg from "pg";
import {
  ensureDirectory,
  loadDotEnv,
  parseArgs,
  projectRootFromMeta,
  requireEnv,
  snapshotDirectory,
  writeJson,
} from "./shared.mjs";

const { Client } = pg;

const rootDir = projectRootFromMeta(import.meta.url);
loadDotEnv(rootDir);

const args = parseArgs(process.argv.slice(2));
const outputDir = resolve(
  rootDir,
  args.out ? String(args.out) : snapshotDirectory(rootDir).replace("migration-data", "migration-data\\postgres-backup"),
);
const tablesDir = join(outputDir, "tables");

ensureDirectory(tablesDir);

const client = new Client({
  connectionString: requireEnv("DATABASE_URL", "Set this to the PostgreSQL database to back up."),
});

await client.connect();

try {
  const tables = await listPublicTables();
  const manifest = {
    exportedAt: new Date().toISOString(),
    source: "postgres",
    tables: {},
    note: "Local PostgreSQL backup before final migration merge. Keep this out of Git.",
  };

  console.log(`Exporting PostgreSQL backup to ${outputDir}`);

  for (const table of tables) {
    const rows = await exportTable(table);
    writeJson(join(tablesDir, `${table}.json`), rows);
    manifest.tables[table] = rows.length;
    console.log(`${table} -> ${rows.length} rows`);
  }

  writeJson(join(outputDir, "manifest.json"), manifest);
  console.log("PostgreSQL backup export complete.");
} finally {
  await client.end();
}

async function listPublicTables() {
  const { rows } = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
    order by table_name
  `);

  return rows.map((row) => row.table_name);
}

async function exportTable(table) {
  const { rows } = await client.query(`select * from ${quoteIdent(table)} order by 1`);
  return rows;
}

function quoteIdent(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}
