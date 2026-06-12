import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { loadDotEnv, parseArgs, projectRootFromMeta, readJson, requireEnv } from "./shared.mjs";

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

const menuItems = readJson(join(snapshotDir, "tables", "menu_items.json"));
const auditLog = readJson(join(snapshotDir, "tables", "audit_log.json"));
const authUsers = readJson(join(snapshotDir, "auth_users.json"));

const client = new Client({
  connectionString: requireEnv("DATABASE_URL", "Set this to the PostgreSQL database to inspect."),
});

await client.connect();

try {
  await reportExtraMenuItems();
  await reportExtraUsers();
  await reportExtraAuditLogs();
} finally {
  await client.end();
}

async function reportExtraMenuItems() {
  const ids = menuItems.map((item) => item.id);
  const { rows } = await client.query(
    `
      select mi.id, mi.name, coalesce(mc.name, '') as category
      from menu_items mi
      left join menu_categories mc on mc.id = mi.category_id
      where not (mi.id = any($1::uuid[]))
      order by mi.created_at
      limit 20
    `,
    [ids],
  );

  console.log(`extra menu_items: ${rows.length}`);
  for (const row of rows) {
    console.log(`- ${row.name} (${row.category})`);
  }
}

async function reportExtraUsers() {
  const ids = authUsers.map((user) => user.id);
  const { rows } = await client.query(
    `
      select u.id, u.email, coalesce(p.full_name, '') as full_name
      from users u
      left join profiles p on p.id = u.id
      where not (u.id = any($1::uuid[]))
      order by u.created_at
      limit 20
    `,
    [ids],
  );

  console.log(`extra users: ${rows.length}`);
  for (const row of rows) {
    console.log(`- ${row.email} (${row.full_name || row.id})`);
  }
}

async function reportExtraAuditLogs() {
  const ids = auditLog.map((entry) => entry.id);
  const { rows } = await client.query(
    `
      select entity, action, count(*)::int as count
      from audit_log
      where not (id = any($1::uuid[]))
      group by entity, action
      order by count desc, entity, action
      limit 20
    `,
    [ids],
  );

  console.log(`extra audit_log groups: ${rows.length}`);
  for (const row of rows) {
    console.log(`- ${row.entity}.${row.action}: ${row.count}`);
  }
}
