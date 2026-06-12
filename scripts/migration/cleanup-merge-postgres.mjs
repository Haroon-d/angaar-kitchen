import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { loadDotEnv, parseArgs, projectRootFromMeta, readJson, requireEnv } from "./shared.mjs";

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

const orders = readJson(join(snapshotDir, "tables", "orders.json"));
const orderItems = readJson(join(snapshotDir, "tables", "order_items.json"));
const orderCounters = readJson(join(snapshotDir, "tables", "order_counters.json"));
const menuItems = readJson(join(snapshotDir, "tables", "menu_items.json"));

const client = new Client({
  connectionString: requireEnv("DATABASE_URL", "Set this to the target PostgreSQL database."),
});

await client.connect();

try {
  await client.query("begin");

  await removeStaleOrderItems();
  await removeStaleOrderCounters();
  await removeStaleDeliveryChargeMenuItems();

  if (shouldCommit) {
    await client.query("commit");
    console.log("PostgreSQL merge cleanup committed.");
  } else {
    await client.query("rollback");
    console.log("Dry-run cleanup succeeded and was rolled back. Re-run with --commit to write.");
  }
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

async function removeStaleDeliveryChargeMenuItems() {
  const sourceMenuItemIds = menuItems.map((item) => item.id);

  const { rowCount } = await client.query(
    `
      delete from menu_items mi
      using menu_categories mc
      where mc.id = mi.category_id
        and not (mi.id = any($1::uuid[]))
        and (
          mi.name ~* '\\m(delivery\\s*charges?|delivery\\s*fees?)\\M'
          or mc.name ~* '\\mdelivery\\M'
        )
    `,
    [sourceMenuItemIds],
  );

  console.log(`menu_items <- removed ${rowCount} stale delivery-charge row(s)`);
}

async function removeStaleOrderItems() {
  const sourceOrderIds = orders.map((order) => order.id);
  const sourceOrderItemIds = orderItems.map((item) => item.id);

  const { rowCount } = await client.query(
    `
      delete from order_items
      where order_id = any($1::uuid[])
        and not (id = any($2::uuid[]))
    `,
    [sourceOrderIds, sourceOrderItemIds],
  );

  console.log(`order_items <- removed ${rowCount} stale row(s)`);
}

async function removeStaleOrderCounters() {
  const sourceKeys = orderCounters.map((counter) => [
    counter.branch_id,
    new Date(counter.counter_date).toISOString().slice(0, 10),
  ]);

  if (!sourceKeys.length) return;

  const sourceBranches = sourceKeys.map(([branchId]) => branchId);
  const sourceDates = sourceKeys.map(([, counterDate]) => counterDate);

  const { rowCount } = await client.query(
    `
      delete from order_counters oc
      where exists (
        select 1
        from unnest($1::uuid[], $2::date[]) source(branch_id, counter_date)
        where source.branch_id = oc.branch_id
      )
      and not exists (
        select 1
        from unnest($1::uuid[], $2::date[]) source(branch_id, counter_date)
        where source.branch_id = oc.branch_id
          and source.counter_date = oc.counter_date
      )
    `,
    [sourceBranches, sourceDates],
  );

  console.log(`order_counters <- removed ${rowCount} stale row(s)`);
}
