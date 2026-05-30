import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATION_TABLES = [
  "profiles",
  "restaurants",
  "branches",
  "user_roles",
  "taxes",
  "operating_hours",
  "menu_categories",
  "menu_items",
  "item_variants",
  "addon_groups",
  "addons",
  "item_addon_groups",
  "order_counters",
  "orders",
  "order_items",
  "order_item_addons",
  "order_taxes",
  "payments",
  "audit_log",
  "inventory_items",
  "suppliers",
  "inventory_purchases",
  "inventory_purchase_lines",
  "inventory_recipes",
  "inventory_movements",
  "operational_expense_categories",
  "operational_expenses",
  "branch_printer_settings",
];

export const IMPORT_TABLES = [
  "users",
  "profiles",
  "restaurants",
  "branches",
  "user_roles",
  "taxes",
  "operating_hours",
  "menu_categories",
  "menu_items",
  "item_variants",
  "addon_groups",
  "addons",
  "item_addon_groups",
  "order_counters",
  "orders",
  "order_items",
  "order_item_addons",
  "order_taxes",
  "payments",
  "audit_log",
  "inventory_items",
  "suppliers",
  "inventory_purchases",
  "inventory_purchase_lines",
  "inventory_recipes",
  "inventory_movements",
  "operational_expense_categories",
  "operational_expenses",
  "branch_printer_settings",
];

export const ROW_COUNT_TABLES = IMPORT_TABLES.filter(
  (table) => !["password_credentials", "sessions", "password_reset_tokens"].includes(table),
);

export const TARGET_COLUMNS = {
  profiles: ["id", "full_name", "phone", "avatar_url", "created_at", "updated_at"],
  restaurants: [
    "id",
    "owner_id",
    "name",
    "legal_name",
    "logo_url",
    "currency",
    "currency_symbol",
    "timezone",
    "phone",
    "email",
    "address",
    "created_at",
    "updated_at",
  ],
  branches: [
    "id",
    "restaurant_id",
    "code",
    "name",
    "address",
    "phone",
    "is_active",
    "created_at",
    "updated_at",
  ],
  user_roles: ["id", "user_id", "restaurant_id", "branch_id", "role", "created_at"],
  taxes: [
    "id",
    "restaurant_id",
    "name",
    "rate",
    "is_inclusive",
    "is_active",
    "apply_by_default",
    "created_at",
  ],
  operating_hours: ["id", "branch_id", "weekday", "open_time", "close_time", "is_closed"],
  menu_categories: [
    "id",
    "branch_id",
    "name",
    "description",
    "image_url",
    "sort_order",
    "is_active",
    "created_at",
    "updated_at",
  ],
  menu_items: [
    "id",
    "category_id",
    "branch_id",
    "name",
    "description",
    "base_price",
    "image_url",
    "is_available",
    "is_veg",
    "prep_time_min",
    "sort_order",
    "created_at",
    "updated_at",
  ],
  item_variants: ["id", "item_id", "name", "price_delta", "is_default", "sort_order"],
  addon_groups: [
    "id",
    "branch_id",
    "name",
    "min_select",
    "max_select",
    "is_required",
    "created_at",
  ],
  addons: ["id", "group_id", "name", "price", "is_active"],
  item_addon_groups: ["item_id", "group_id"],
  order_counters: ["branch_id", "counter_date", "last_seq"],
  orders: [
    "id",
    "branch_id",
    "order_no",
    "dining_type",
    "status",
    "payment_status",
    "customer_name",
    "customer_phone",
    "table_label",
    "notes",
    "subtotal",
    "discount_total",
    "tax_total",
    "grand_total",
    "amount_paid",
    "idempotency_key",
    "created_by",
    "created_at",
    "updated_at",
    "completed_at",
  ],
  order_items: [
    "id",
    "order_id",
    "item_id",
    "variant_id",
    "name_snapshot",
    "variant_snapshot",
    "unit_price",
    "qty",
    "addons_total",
    "line_subtotal",
    "notes",
  ],
  order_item_addons: ["id", "order_item_id", "addon_id", "name_snapshot", "price_snapshot"],
  order_taxes: ["id", "order_id", "tax_id", "name_snapshot", "rate_snapshot", "amount"],
  payments: ["id", "order_id", "method", "kind", "amount", "reference", "paid_at", "received_by"],
  audit_log: [
    "id",
    "restaurant_id",
    "branch_id",
    "actor_id",
    "entity",
    "entity_id",
    "action",
    "meta",
    "created_at",
  ],
  inventory_items: [
    "id",
    "branch_id",
    "name",
    "category",
    "base_unit",
    "current_qty",
    "reorder_level",
    "average_cost",
    "is_active",
    "created_at",
    "updated_at",
  ],
  suppliers: [
    "id",
    "restaurant_id",
    "name",
    "phone",
    "email",
    "address",
    "notes",
    "is_active",
    "created_at",
    "updated_at",
  ],
  inventory_purchases: [
    "id",
    "branch_id",
    "supplier_id",
    "invoice_no",
    "purchase_date",
    "notes",
    "total",
    "created_by",
    "created_at",
  ],
  inventory_purchase_lines: [
    "id",
    "purchase_id",
    "inventory_item_id",
    "quantity",
    "unit",
    "pack_size",
    "base_quantity",
    "unit_cost",
    "line_total",
  ],
  inventory_recipes: [
    "id",
    "menu_item_id",
    "inventory_item_id",
    "quantity",
    "standard_source",
    "learning_enabled",
    "created_at",
    "updated_at",
  ],
  inventory_movements: [
    "id",
    "branch_id",
    "inventory_item_id",
    "movement_type",
    "reason",
    "quantity_delta",
    "before_qty",
    "after_qty",
    "unit_cost",
    "related_order_id",
    "related_purchase_id",
    "actor_id",
    "note",
    "created_at",
  ],
  operational_expense_categories: [
    "id",
    "branch_id",
    "name",
    "description",
    "is_active",
    "created_at",
    "updated_at",
  ],
  operational_expenses: [
    "id",
    "branch_id",
    "category_id",
    "expense_date",
    "title",
    "vendor",
    "reference_no",
    "payment_method",
    "status",
    "amount",
    "notes",
    "created_by",
    "created_at",
    "updated_at",
  ],
  branch_printer_settings: ["branch_id", "settings", "created_at", "updated_at"],
};

export function loadDotEnv(rootDir = process.cwd()) {
  loadEnvFile(join(rootDir, ".env.local"));
  loadEnvFile(join(rootDir, ".env"));
}

function loadEnvFile(envPath) {
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] != null) continue;

    process.env[key] = unquoteEnvValue(rawValue.trim());
  }
}

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (inlineValue != null) {
      args[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }

  return args;
}

export function requireEnv(name, hint) {
  const value = process.env[name];
  if (!value) {
    const suffix = hint ? ` ${hint}` : "";
    throw new Error(`Missing required environment variable ${name}.${suffix}`);
  }

  return value;
}

export function projectRootFromMeta(importMetaUrl) {
  const currentFile = fileURLToPath(importMetaUrl);
  return resolve(dirname(currentFile), "..", "..");
}

export function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path, value) {
  ensureDirectory(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function snapshotDirectory(rootDir) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(rootDir, "migration-data", stamp);
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
