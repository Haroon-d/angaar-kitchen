import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const appRole = pgEnum("app_role", [
  "owner",
  "admin",
  "manager",
  "cashier",
  "kitchen",
  "waiter",
]);

export const diningType = pgEnum("dining_type", ["dine_in", "takeaway", "delivery"]);

export const orderStatus = pgEnum("order_status", [
  "open",
  "placed",
  "preparing",
  "ready",
  "served",
  "completed",
  "cancelled",
  "voided",
  "refunded",
]);

export const paymentMethod = pgEnum("payment_method", ["cash", "card", "upi", "wallet", "other"]);

export const paymentStatus = pgEnum("payment_status", ["pending", "partial", "paid", "refunded"]);

export const paymentKind = pgEnum("payment_kind", ["payment", "refund", "void_adjustment"]);

export const couponDiscountType = pgEnum("coupon_discount_type", [
  "amount",
  "percent",
  "free_delivery",
]);
export const couponAppliesTo = pgEnum("coupon_applies_to", ["both", "pos", "website"]);

export const inventoryUnit = pgEnum("inventory_unit", ["g", "kg", "ml", "l", "piece", "pack"]);
export const inventoryBaseUnit = pgEnum("inventory_base_unit", ["g", "ml", "piece"]);
export const inventoryMovementType = pgEnum("inventory_movement_type", [
  "purchase",
  "sale",
  "adjustment",
  "waste",
  "correction",
  "staff_meal",
  "damage",
]);
export const inventoryAdjustmentReason = pgEnum("inventory_adjustment_reason", [
  "purchase",
  "sale",
  "waste",
  "damage",
  "correction",
  "staff_meal",
  "other",
]);

export const operationalExpenseStatus = pgEnum("operational_expense_status", [
  "due",
  "paid",
  "void",
]);

const createdAt = timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const passwordCredentials = pgTable("password_credentials", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt,
  },
  (table) => [
    index("sessions_user_idx").on(table.userId),
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
  ],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    index("password_reset_tokens_user_idx").on(table.userId),
    uniqueIndex("password_reset_tokens_hash_unique").on(table.tokenHash),
  ],
);

export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  fullName: text("full_name"),
  phone: text("phone"),
  avatarUrl: text("avatar_url"),
  createdAt,
  updatedAt,
});

export const restaurants = pgTable("restaurants", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  logoUrl: text("logo_url"),
  currency: text("currency").default("PKR").notNull(),
  currencySymbol: text("currency_symbol").default("Rs").notNull(),
  timezone: text("timezone").default("Asia/Karachi").notNull(),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  createdAt,
  updatedAt,
});

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    address: text("address"),
    phone: text("phone"),
    deliveryFee: numeric("delivery_fee", { precision: 12, scale: 2 }).default("0").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("branches_restaurant_code_unique").on(table.restaurantId, table.code)],
);

export const userRoles = pgTable(
  "user_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "cascade" }),
    role: appRole("role").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("user_roles_branch_unique")
      .on(table.userId, table.restaurantId, table.branchId, table.role)
      .where(sql`${table.branchId} is not null`),
    uniqueIndex("user_roles_restaurant_unique")
      .on(table.userId, table.restaurantId, table.role)
      .where(sql`${table.branchId} is null`),
    index("user_roles_scope_idx").on(table.userId, table.restaurantId, table.branchId),
    index("user_roles_user_idx").on(table.userId),
  ],
);

export const taxes = pgTable(
  "taxes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rate: numeric("rate", { precision: 6, scale: 3 }).notNull(),
    isInclusive: boolean("is_inclusive").default(false).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    applyByDefault: boolean("apply_by_default").default(true).notNull(),
    createdAt,
  },
  (table) => [index("taxes_restaurant_idx").on(table.restaurantId)],
);

export const operatingHours = pgTable(
  "operating_hours",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(),
    openTime: time("open_time"),
    closeTime: time("close_time"),
    isClosed: boolean("is_closed").default(false).notNull(),
  },
  (table) => [
    uniqueIndex("operating_hours_branch_weekday_unique").on(table.branchId, table.weekday),
  ],
);

export const menuCategories = pgTable(
  "menu_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    sortOrder: integer("sort_order").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [index("menu_categories_branch_idx").on(table.branchId)],
);

export const menuItems = pgTable(
  "menu_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => menuCategories.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    basePrice: numeric("base_price", { precision: 12, scale: 2 }).notNull(),
    imageUrl: text("image_url"),
    isAvailable: boolean("is_available").default(true).notNull(),
    isVeg: boolean("is_veg"),
    isBestSeller: boolean("is_best_seller").default(false).notNull(),
    isChefRecommended: boolean("is_chef_recommended").default(false).notNull(),
    isPopular: boolean("is_popular").default(false).notNull(),
    isNewItem: boolean("is_new_item").default(false).notNull(),
    spiceLevel: text("spice_level"),
    servingSize: text("serving_size"),
    prepTimeMin: integer("prep_time_min").default(15),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("menu_items_branch_idx").on(table.branchId),
    index("menu_items_category_idx").on(table.categoryId),
  ],
);

export const itemVariants = pgTable("item_variants", {
  id: uuid("id").defaultRandom().primaryKey(),
  itemId: uuid("item_id")
    .notNull()
    .references(() => menuItems.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  priceDelta: numeric("price_delta", { precision: 12, scale: 2 }).default("0").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
});

export const addonGroups = pgTable("addon_groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => branches.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  minSelect: integer("min_select").default(0).notNull(),
  maxSelect: integer("max_select").default(1).notNull(),
  isRequired: boolean("is_required").default(false).notNull(),
  createdAt,
});

export const addons = pgTable("addons", {
  id: uuid("id").defaultRandom().primaryKey(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => addonGroups.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  price: numeric("price", { precision: 12, scale: 2 }).default("0").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
});

export const itemAddonGroups = pgTable(
  "item_addon_groups",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => addonGroups.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.itemId, table.groupId] })],
);

export const homepagePromotions = pgTable(
  "homepage_promotions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    description: text("description"),
    imageUrl: text("image_url"),
    ctaText: text("cta_text").default("Order now").notNull(),
    ctaLink: text("cta_link").default("#order").notNull(),
    actionType: text("action_type").default("link").notNull(),
    menuItemId: uuid("menu_item_id").references(() => menuItems.id, { onDelete: "set null" }),
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    priority: integer("priority").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("homepage_promotions_restaurant_active_idx").on(
      table.restaurantId,
      table.isActive,
      table.priority,
    ),
    index("homepage_promotions_menu_item_idx").on(table.menuItemId),
  ],
);

export const productAnalyticsEvents = pgTable(
  "product_analytics_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    itemId: uuid("item_id").references(() => menuItems.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    searchQuery: text("search_query"),
    sessionId: text("session_id"),
    createdAt,
  },
  (table) => [
    index("product_analytics_restaurant_event_idx").on(
      table.restaurantId,
      table.eventType,
      table.createdAt,
    ),
    index("product_analytics_item_event_idx").on(table.itemId, table.eventType, table.createdAt),
  ],
);

export const orderCounters = pgTable(
  "order_counters",
  {
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    counterDate: date("counter_date").notNull(),
    lastSeq: integer("last_seq").default(0).notNull(),
  },
  (table) => [primaryKey({ columns: [table.branchId, table.counterDate] })],
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    name: text("name"),
    primaryPhone: text("primary_phone").notNull(),
    phoneNormalized: text("phone_normalized").notNull(),
    email: text("email"),
    defaultAddress: text("default_address"),
    notes: text("notes"),
    spicePreference: text("spice_preference"),
    isVip: boolean("is_vip").default(false).notNull(),
    isBlocked: boolean("is_blocked").default(false).notNull(),
    firstOrderAt: timestamp("first_order_at", { withTimezone: true }),
    lastOrderAt: timestamp("last_order_at", { withTimezone: true }),
    totalOrders: integer("total_orders").default(0).notNull(),
    totalSpent: numeric("total_spent", { precision: 14, scale: 2 }).default("0").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("customers_restaurant_phone_unique").on(
      table.restaurantId,
      table.phoneNormalized,
    ),
    index("customers_restaurant_last_order_idx").on(table.restaurantId, table.lastOrderAt),
    index("customers_branch_last_order_idx").on(table.branchId, table.lastOrderAt),
  ],
);

export const customerAddresses = pgTable(
  "customer_addresses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    label: text("label").default("Delivery").notNull(),
    address: text("address").notNull(),
    area: text("area"),
    city: text("city"),
    instructions: text("instructions"),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("customer_addresses_customer_address_unique").on(table.customerId, table.address),
    index("customer_addresses_customer_idx").on(table.customerId),
  ],
);

export const couponCampaigns = pgTable(
  "coupon_campaigns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    discountType: couponDiscountType("discount_type").notNull(),
    discountValue: numeric("discount_value", { precision: 12, scale: 2 }).notNull(),
    maxDiscount: numeric("max_discount", { precision: 12, scale: 2 }),
    minOrderTotal: numeric("min_order_total", { precision: 12, scale: 2 }).default("0").notNull(),
    usageLimit: integer("usage_limit"),
    perCustomerLimit: integer("per_customer_limit").default(1).notNull(),
    appliesTo: couponAppliesTo("applies_to").default("both").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    isActive: boolean("is_active").default(true).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("coupon_campaigns_restaurant_code_unique").on(table.restaurantId, table.code),
    index("coupon_campaigns_restaurant_active_idx").on(table.restaurantId, table.isActive),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    orderNo: text("order_no").notNull(),
    diningType: diningType("dining_type").default("dine_in").notNull(),
    status: orderStatus("status").default("open").notNull(),
    paymentStatus: paymentStatus("payment_status").default("pending").notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),
    tableLabel: text("table_label"),
    notes: text("notes"),
    subtotal: numeric("subtotal", { precision: 12, scale: 2 }).default("0").notNull(),
    discountTotal: numeric("discount_total", { precision: 12, scale: 2 }).default("0").notNull(),
    taxTotal: numeric("tax_total", { precision: 12, scale: 2 }).default("0").notNull(),
    deliveryFee: numeric("delivery_fee", { precision: 12, scale: 2 }).default("0").notNull(),
    grandTotal: numeric("grand_total", { precision: 12, scale: 2 }).default("0").notNull(),
    amountPaid: numeric("amount_paid", { precision: 12, scale: 2 }).default("0").notNull(),
    couponId: uuid("coupon_id").references(() => couponCampaigns.id, { onDelete: "set null" }),
    kotPrintCount: integer("kot_print_count").default(0).notNull(),
    billPrintCount: integer("bill_print_count").default(0).notNull(),
    receiptPrintCount: integer("receipt_print_count").default(0).notNull(),
    idempotencyKey: uuid("idempotency_key"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt,
    updatedAt,
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("orders_order_no_unique").on(table.orderNo),
    uniqueIndex("orders_idempotency_key_unique").on(table.idempotencyKey),
    index("orders_branch_created_idx").on(table.branchId, table.createdAt),
    index("orders_customer_idx").on(table.customerId),
    index("orders_status_idx").on(table.status),
  ],
);

export const customerReviews = pgTable(
  "customer_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    review: text("review"),
    isVerifiedPurchase: boolean("is_verified_purchase").default(true).notNull(),
    isApproved: boolean("is_approved").default(false).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("customer_reviews_order_customer_unique").on(table.orderId, table.customerId),
    index("customer_reviews_restaurant_approved_idx").on(
      table.restaurantId,
      table.isApproved,
      table.createdAt,
    ),
  ],
);

export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    couponId: uuid("coupon_id")
      .notNull()
      .references(() => couponCampaigns.id, { onDelete: "restrict" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    codeSnapshot: text("code_snapshot").notNull(),
    discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("coupon_redemptions_coupon_order_unique").on(table.couponId, table.orderId),
    index("coupon_redemptions_coupon_idx").on(table.couponId),
    index("coupon_redemptions_customer_idx").on(table.customerId),
    index("coupon_redemptions_restaurant_created_idx").on(table.restaurantId, table.createdAt),
  ],
);

export const customerEvents = pgTable(
  "customer_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    meta: jsonb("meta").default({}).notNull(),
    createdAt,
  },
  (table) => [
    index("customer_events_customer_created_idx").on(table.customerId, table.createdAt),
    index("customer_events_restaurant_created_idx").on(table.restaurantId, table.createdAt),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").references(() => menuItems.id, { onDelete: "set null" }),
    variantId: uuid("variant_id").references(() => itemVariants.id, { onDelete: "set null" }),
    nameSnapshot: text("name_snapshot").notNull(),
    variantSnapshot: text("variant_snapshot"),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    qty: integer("qty").notNull(),
    addonsTotal: numeric("addons_total", { precision: 12, scale: 2 }).default("0").notNull(),
    lineSubtotal: numeric("line_subtotal", { precision: 12, scale: 2 }).notNull(),
    notes: text("notes"),
  },
  (table) => [index("order_items_order_idx").on(table.orderId)],
);

export const orderItemAddons = pgTable("order_item_addons", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderItemId: uuid("order_item_id")
    .notNull()
    .references(() => orderItems.id, { onDelete: "cascade" }),
  addonId: uuid("addon_id").references(() => addons.id, { onDelete: "set null" }),
  nameSnapshot: text("name_snapshot").notNull(),
  priceSnapshot: numeric("price_snapshot", { precision: 12, scale: 2 }).notNull(),
});

export const orderTaxes = pgTable("order_taxes", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  taxId: uuid("tax_id").references(() => taxes.id, { onDelete: "set null" }),
  nameSnapshot: text("name_snapshot").notNull(),
  rateSnapshot: numeric("rate_snapshot", { precision: 6, scale: 3 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
});

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    method: paymentMethod("method").notNull(),
    kind: paymentKind("kind").default("payment").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    reference: text("reference"),
    paidAt: timestamp("paid_at", { withTimezone: true }).defaultNow().notNull(),
    receivedBy: uuid("received_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [index("payments_order_idx").on(table.orderId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id").references(() => restaurants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id"),
    action: text("action").notNull(),
    meta: jsonb("meta").default({}).notNull(),
    createdAt,
  },
  (table) => [index("audit_log_restaurant_created_idx").on(table.restaurantId, table.createdAt)],
);

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category"),
    baseUnit: inventoryBaseUnit("base_unit").notNull(),
    currentQty: numeric("current_qty", { precision: 14, scale: 3 }).default("0").notNull(),
    reorderLevel: numeric("reorder_level", { precision: 14, scale: 3 }).default("0").notNull(),
    averageCost: numeric("average_cost", { precision: 14, scale: 6 }).default("0").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [index("inventory_items_branch_idx").on(table.branchId, table.isActive, table.name)],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    notes: text("notes"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [index("suppliers_restaurant_idx").on(table.restaurantId, table.isActive, table.name)],
);

export const inventoryPurchases = pgTable(
  "inventory_purchases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    invoiceNo: text("invoice_no"),
    purchaseDate: date("purchase_date").notNull(),
    notes: text("notes"),
    total: numeric("total", { precision: 14, scale: 2 }).default("0").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt,
  },
  (table) => [index("inventory_purchases_branch_idx").on(table.branchId, table.purchaseDate)],
);

export const inventoryPurchaseLines = pgTable(
  "inventory_purchase_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => inventoryPurchases.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    unit: inventoryUnit("unit").notNull(),
    packSize: numeric("pack_size", { precision: 14, scale: 3 }),
    baseQuantity: numeric("base_quantity", { precision: 14, scale: 3 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 14, scale: 4 }).notNull(),
    lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull(),
  },
  (table) => [
    index("inventory_purchase_lines_purchase_idx").on(table.purchaseId),
    index("inventory_purchase_lines_item_idx").on(table.inventoryItemId),
  ],
);

export const inventoryRecipes = pgTable(
  "inventory_recipes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    menuItemId: uuid("menu_item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    standardSource: text("standard_source").default("manual").notNull(),
    learningEnabled: boolean("learning_enabled").default(false).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("inventory_recipes_unique").on(table.menuItemId, table.inventoryItemId),
    index("inventory_recipes_menu_item_idx").on(table.menuItemId),
  ],
);

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    movementType: inventoryMovementType("movement_type").notNull(),
    reason: inventoryAdjustmentReason("reason"),
    quantityDelta: numeric("quantity_delta", { precision: 14, scale: 3 }).notNull(),
    beforeQty: numeric("before_qty", { precision: 14, scale: 3 }).notNull(),
    afterQty: numeric("after_qty", { precision: 14, scale: 3 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 14, scale: 6 }).default("0").notNull(),
    relatedOrderId: uuid("related_order_id").references(() => orders.id, { onDelete: "set null" }),
    relatedPurchaseId: uuid("related_purchase_id").references(() => inventoryPurchases.id, {
      onDelete: "set null",
    }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt,
  },
  (table) => [
    index("inventory_movements_branch_created_idx").on(table.branchId, table.createdAt),
    index("inventory_movements_item_created_idx").on(table.inventoryItemId, table.createdAt),
    index("inventory_movements_order_idx").on(table.relatedOrderId),
  ],
);

export const operationalExpenseCategories = pgTable(
  "operational_expense_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("operational_expense_categories_unique").on(table.branchId, table.name),
    index("operational_expense_categories_branch_idx").on(
      table.branchId,
      table.isActive,
      table.name,
    ),
  ],
);

export const operationalExpenses = pgTable(
  "operational_expenses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => operationalExpenseCategories.id, {
      onDelete: "set null",
    }),
    expenseDate: date("expense_date").notNull(),
    title: text("title").notNull(),
    vendor: text("vendor"),
    referenceNo: text("reference_no"),
    paymentMethod: paymentMethod("payment_method"),
    status: operationalExpenseStatus("status").default("paid").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("operational_expenses_branch_date_idx").on(
      table.branchId,
      table.expenseDate,
      table.status,
    ),
    index("operational_expenses_category_idx").on(table.categoryId),
  ],
);

export const branchPrinterSettings = pgTable(
  "branch_printer_settings",
  {
    branchId: uuid("branch_id")
      .primaryKey()
      .references(() => branches.id, { onDelete: "cascade" }),
    settings: jsonb("settings").default({}).notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [index("branch_printer_settings_updated_idx").on(table.updatedAt)],
);
