import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import {
  loadDotEnv,
  parseArgs,
  projectRootFromMeta,
  requireEnv,
  ROW_COUNT_TABLES,
} from "./shared.mjs";

const execFileAsync = promisify(execFile);
const { Client } = pg;

const rootDir = projectRootFromMeta(import.meta.url);
loadDotEnv(rootDir);

const args = parseArgs(process.argv.slice(2));
const requireSupabase = args.requireSupabase === true;
const requireEmpty = args.allowNonEmpty !== true;

let failures = 0;
const warnings = [];

console.log("Running PostgreSQL migration preflight...");

await checkCommand("node", ["--version"], "Node.js");
await checkDocker();

checkEnv("DATABASE_URL", "required");
checkEnv("SESSION_SECRET", "required");

checkEnv("SUPABASE_URL", requireSupabase ? "required" : "warning");
checkEnv("SUPABASE_SERVICE_ROLE_KEY", requireSupabase ? "required" : "warning");

await checkPostgres();

if (failures > 0) {
  console.error(`Preflight failed with ${failures} blocking issue(s).`);
  process.exit(1);
}

for (const warning of warnings) {
  console.warn(`warning: ${warning}`);
}

console.log("Preflight passed.");

async function checkCommand(command, args, label) {
  try {
    const { stdout } = await execFileAsync(command, args, { cwd: rootDir });
    console.log(`ok       ${label}: ${stdout.trim()}`);
  } catch (error) {
    fail(`${label} command is not available: ${command}`);
  }
}

async function checkDocker() {
  try {
    const { stdout } = await execFileAsync("docker", ["--version"], { cwd: rootDir });
    console.log(`ok       Docker: ${stdout.trim()}`);
  } catch {
    warnings.push("Docker CLI is not available. Start PostgreSQL another way before db:migrate.");
  }
}

function checkEnv(name, level) {
  if (process.env[name]) {
    console.log(`ok       env ${name}`);
    return;
  }

  if (level === "required") {
    fail(`Missing required environment variable ${name}.`);
    return;
  }

  warnings.push(`Missing ${name}; real Supabase export cannot run until it is set.`);
}

async function checkPostgres() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;

  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log("ok       PostgreSQL connection");

    await assertDrizzleMigrationApplied(client);

    if (requireEmpty) {
      await assertTargetDataEmpty(client);
    }
  } catch (error) {
    fail(`PostgreSQL check failed: ${error.message}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function assertDrizzleMigrationApplied(client) {
  const { rows } = await client.query(`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = 'users'
    ) as exists
  `);

  if (!rows[0].exists) {
    fail("PostgreSQL schema is not migrated yet. Run npm.cmd run db:migrate first.");
    return;
  }

  console.log("ok       PostgreSQL schema contains users table");
}

async function assertTargetDataEmpty(client) {
  const nonEmptyTables = [];

  for (const table of ROW_COUNT_TABLES) {
    const { rows } = await client.query(`select count(*)::int as count from ${quoteIdent(table)}`);
    if (rows[0].count > 0) {
      nonEmptyTables.push(`${table}=${rows[0].count}`);
    }
  }

  if (nonEmptyTables.length) {
    fail(
      `Target PostgreSQL database already contains migrated data: ${nonEmptyTables.join(
        ", ",
      )}. Use a fresh database or pass --allow-non-empty intentionally.`,
    );
    return;
  }

  console.log("ok       PostgreSQL target tables are empty");
}

function fail(message) {
  failures += 1;
  console.error(`fail     ${message}`);
}

function quoteIdent(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}
