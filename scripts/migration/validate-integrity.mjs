import pg from "pg";
import { loadDotEnv, projectRootFromMeta, requireEnv } from "./shared.mjs";

const { Client } = pg;

const rootDir = projectRootFromMeta(import.meta.url);
loadDotEnv(rootDir);

const client = new Client({
  connectionString: requireEnv("DATABASE_URL", "Set this to the PostgreSQL database to validate."),
});

const checks = [
  {
    name: "user role branch belongs to role restaurant",
    sql: `
      select count(*)::int as count
      from user_roles ur
      join branches b on b.id = ur.branch_id
      where b.restaurant_id <> ur.restaurant_id
    `,
  },
  {
    name: "restaurant owner has owner role",
    sql: `
      select count(*)::int as count
      from restaurants r
      where not exists (
        select 1
        from user_roles ur
        where ur.user_id = r.owner_id
          and ur.restaurant_id = r.id
          and ur.role = 'owner'
      )
    `,
  },
  {
    name: "menu item category belongs to same branch",
    sql: `
      select count(*)::int as count
      from menu_items mi
      join menu_categories mc on mc.id = mi.category_id
      where mc.branch_id <> mi.branch_id
    `,
  },
  {
    name: "item addon group belongs to same branch as item",
    sql: `
      select count(*)::int as count
      from item_addon_groups iag
      join menu_items mi on mi.id = iag.item_id
      join addon_groups ag on ag.id = iag.group_id
      where ag.branch_id <> mi.branch_id
    `,
  },
  {
    name: "addons belong to active addon groups",
    sql: `
      select count(*)::int as count
      from addons a
      left join addon_groups ag on ag.id = a.group_id
      where ag.id is null
    `,
  },
  {
    name: "orders have non-negative totals",
    sql: `
      select count(*)::int as count
      from orders
      where subtotal < 0
        or discount_total < 0
        or tax_total < 0
        or grand_total < 0
        or amount_paid < 0
    `,
  },
  {
    name: "order items have positive quantities",
    sql: `
      select count(*)::int as count
      from order_items
      where qty <= 0
    `,
  },
  {
    name: "order item addons belong to same order item branch",
    sql: `
      select count(*)::int as count
      from order_item_addons oia
      join order_items oi on oi.id = oia.order_item_id
      join orders o on o.id = oi.order_id
      join addons a on a.id = oia.addon_id
      join addon_groups ag on ag.id = a.group_id
      where ag.branch_id <> o.branch_id
    `,
  },
  {
    name: "order taxes belong to same restaurant as order branch",
    sql: `
      select count(*)::int as count
      from order_taxes ot
      join orders o on o.id = ot.order_id
      join branches b on b.id = o.branch_id
      join taxes t on t.id = ot.tax_id
      where t.restaurant_id <> b.restaurant_id
    `,
  },
  {
    name: "payments have non-zero amounts",
    sql: `
      select count(*)::int as count
      from payments
      where amount = 0
    `,
  },
  {
    name: "inventory recipes use ingredients from same branch as menu item",
    sql: `
      select count(*)::int as count
      from inventory_recipes ir
      join menu_items mi on mi.id = ir.menu_item_id
      join inventory_items ii on ii.id = ir.inventory_item_id
      where ii.branch_id <> mi.branch_id
    `,
  },
  {
    name: "inventory movements use item from same branch",
    sql: `
      select count(*)::int as count
      from inventory_movements im
      join inventory_items ii on ii.id = im.inventory_item_id
      where ii.branch_id <> im.branch_id
    `,
  },
  {
    name: "inventory purchases supplier belongs to branch restaurant",
    sql: `
      select count(*)::int as count
      from inventory_purchases ip
      join branches b on b.id = ip.branch_id
      join suppliers s on s.id = ip.supplier_id
      where s.restaurant_id <> b.restaurant_id
    `,
  },
  {
    name: "inventory purchase lines have positive base quantities",
    sql: `
      select count(*)::int as count
      from inventory_purchase_lines
      where quantity <= 0
        or base_quantity <= 0
        or unit_cost < 0
        or line_total < 0
    `,
  },
  {
    name: "operational expense category belongs to expense branch",
    sql: `
      select count(*)::int as count
      from operational_expenses oe
      join operational_expense_categories c on c.id = oe.category_id
      where c.branch_id <> oe.branch_id
    `,
  },
  {
    name: "operational expenses have non-negative amounts",
    sql: `
      select count(*)::int as count
      from operational_expenses
      where amount < 0
    `,
  },
  {
    name: "branch printer settings exist only for known branches",
    sql: `
      select count(*)::int as count
      from branch_printer_settings bps
      left join branches b on b.id = bps.branch_id
      where b.id is null
    `,
  },
];

await client.connect();

try {
  let failures = 0;

  for (const check of checks) {
    const { rows } = await client.query(check.sql);
    const count = rows[0].count;
    const status = count === 0 ? "ok" : "fail";
    console.log(`${status.padEnd(6)} ${check.name} count=${count}`);
    if (count !== 0) failures += 1;
  }

  if (failures > 0) {
    throw new Error(`${failures} integrity validation check(s) failed.`);
  }

  console.log("PostgreSQL integrity validation passed.");
} finally {
  await client.end();
}
