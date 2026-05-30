import { createClient } from "@supabase/supabase-js";
import { join, resolve } from "node:path";
import {
  ensureDirectory,
  loadDotEnv,
  MIGRATION_TABLES,
  parseArgs,
  projectRootFromMeta,
  requireEnv,
  snapshotDirectory,
  TARGET_COLUMNS,
  writeJson,
} from "./shared.mjs";

const PAGE_SIZE = 1000;

const rootDir = projectRootFromMeta(import.meta.url);
loadDotEnv(rootDir);

const args = parseArgs(process.argv.slice(2));
const outputDir = resolve(rootDir, args.out ? String(args.out) : snapshotDirectory(rootDir));
const tablesDir = join(outputDir, "tables");

ensureDirectory(tablesDir);

const supabaseUrl = requireEnv("SUPABASE_URL", "Set this to the existing Supabase project URL.");
const serviceRoleKey = requireEnv(
  "SUPABASE_SERVICE_ROLE_KEY",
  "Use a service role key locally only; never expose it in browser code.",
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const manifest = {
  exportedAt: new Date().toISOString(),
  source: "supabase",
  dailyClosingRemoved: true,
  auth: {
    exportedUsers: 0,
    note: "Supabase password hashes are not exported. Users must set passwords in PostgreSQL auth after cutover.",
  },
  tables: {},
};

console.log(`Exporting Supabase snapshot to ${outputDir}`);

const authUsers = await exportAuthUsers();
writeJson(join(outputDir, "auth_users.json"), authUsers);
manifest.auth.exportedUsers = authUsers.length;
console.log(`auth.users -> ${authUsers.length} users`);

for (const table of MIGRATION_TABLES) {
  const rows = await exportTable(table);
  writeJson(join(tablesDir, `${table}.json`), rows);
  manifest.tables[table] = rows.length;
  console.log(`${table} -> ${rows.length} rows`);
}

writeJson(join(outputDir, "manifest.json"), manifest);
console.log("Export complete. No writes were made to Supabase.");

async function exportTable(table) {
  const rows = [];
  const columns = TARGET_COLUMNS[table];
  if (!columns) {
    throw new Error(`No target-column projection configured for ${table}.`);
  }

  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase.from(table).select(columns.join(",")).range(from, to);

    if (error) {
      throw new Error(`Failed to export ${table}: ${error.message}`);
    }

    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return rows;
}

async function exportAuthUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: PAGE_SIZE,
    });

    if (error) {
      throw new Error(`Failed to export auth.users: ${error.message}`);
    }

    users.push(...data.users.map(toPortableAuthUser));
    if (data.users.length < PAGE_SIZE) break;
  }

  return users;
}

function toPortableAuthUser(user) {
  return {
    id: user.id,
    email: user.email,
    email_verified_at: user.email_confirmed_at ?? null,
    created_at: user.created_at ?? null,
    updated_at: user.updated_at ?? null,
    is_active: !user.banned_until,
  };
}
