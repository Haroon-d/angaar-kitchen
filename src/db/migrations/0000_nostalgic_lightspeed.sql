CREATE TYPE "public"."app_role" AS ENUM('owner', 'admin', 'manager', 'cashier', 'kitchen', 'waiter');--> statement-breakpoint
CREATE TYPE "public"."dining_type" AS ENUM('dine_in', 'takeaway', 'delivery');--> statement-breakpoint
CREATE TYPE "public"."inventory_adjustment_reason" AS ENUM('purchase', 'sale', 'waste', 'damage', 'correction', 'staff_meal', 'other');--> statement-breakpoint
CREATE TYPE "public"."inventory_base_unit" AS ENUM('g', 'ml', 'piece');--> statement-breakpoint
CREATE TYPE "public"."inventory_movement_type" AS ENUM('purchase', 'sale', 'adjustment', 'waste', 'correction', 'staff_meal', 'damage');--> statement-breakpoint
CREATE TYPE "public"."inventory_unit" AS ENUM('g', 'kg', 'ml', 'l', 'piece', 'pack');--> statement-breakpoint
CREATE TYPE "public"."operational_expense_status" AS ENUM('due', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('open', 'placed', 'preparing', 'ready', 'served', 'completed', 'cancelled', 'voided', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('payment', 'refund', 'void_adjustment');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'card', 'upi', 'wallet', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'partial', 'paid', 'refunded');--> statement-breakpoint
CREATE TABLE "addon_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"min_select" integer DEFAULT 0 NOT NULL,
	"max_select" integer DEFAULT 1 NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid,
	"branch_id" uuid,
	"actor_id" uuid,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branch_printer_settings" (
	"branch_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"base_unit" "inventory_base_unit" NOT NULL,
	"current_qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"reorder_level" numeric(14, 3) DEFAULT '0' NOT NULL,
	"average_cost" numeric(14, 6) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"movement_type" "inventory_movement_type" NOT NULL,
	"reason" "inventory_adjustment_reason",
	"quantity_delta" numeric(14, 3) NOT NULL,
	"before_qty" numeric(14, 3) NOT NULL,
	"after_qty" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(14, 6) DEFAULT '0' NOT NULL,
	"related_order_id" uuid,
	"related_purchase_id" uuid,
	"actor_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_purchase_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit" "inventory_unit" NOT NULL,
	"pack_size" numeric(14, 3),
	"base_quantity" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(14, 4) NOT NULL,
	"line_total" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"supplier_id" uuid,
	"invoice_no" text,
	"purchase_date" date NOT NULL,
	"notes" text,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"standard_source" text DEFAULT 'manual' NOT NULL,
	"learning_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_addon_groups" (
	"item_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	CONSTRAINT "item_addon_groups_item_id_group_id_pk" PRIMARY KEY("item_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "item_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_delta" numeric(12, 2) DEFAULT '0' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base_price" numeric(12, 2) NOT NULL,
	"image_url" text,
	"is_available" boolean DEFAULT true NOT NULL,
	"is_veg" boolean,
	"prep_time_min" integer DEFAULT 15,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operating_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"open_time" time,
	"close_time" time,
	"is_closed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"category_id" uuid,
	"expense_date" date NOT NULL,
	"title" text NOT NULL,
	"vendor" text,
	"reference_no" text,
	"payment_method" "payment_method",
	"status" "operational_expense_status" DEFAULT 'paid' NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_counters" (
	"branch_id" uuid NOT NULL,
	"counter_date" date NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "order_counters_branch_id_counter_date_pk" PRIMARY KEY("branch_id","counter_date")
);
--> statement-breakpoint
CREATE TABLE "order_item_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"addon_id" uuid,
	"name_snapshot" text NOT NULL,
	"price_snapshot" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"item_id" uuid,
	"variant_id" uuid,
	"name_snapshot" text NOT NULL,
	"variant_snapshot" text,
	"unit_price" numeric(12, 2) NOT NULL,
	"qty" integer NOT NULL,
	"addons_total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"line_subtotal" numeric(12, 2) NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "order_taxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"tax_id" uuid,
	"name_snapshot" text NOT NULL,
	"rate_snapshot" numeric(6, 3) NOT NULL,
	"amount" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"order_no" text NOT NULL,
	"dining_type" "dining_type" DEFAULT 'dine_in' NOT NULL,
	"status" "order_status" DEFAULT 'open' NOT NULL,
	"payment_status" "payment_status" DEFAULT 'pending' NOT NULL,
	"customer_name" text,
	"customer_phone" text,
	"table_label" text,
	"notes" text,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"discount_total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(12, 2) DEFAULT '0' NOT NULL,
	"idempotency_key" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "password_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"kind" "payment_kind" DEFAULT 'payment' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"reference" text,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" uuid
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text,
	"phone" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restaurants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"logo_url" text,
	"currency" text DEFAULT 'PKR' NOT NULL,
	"currency_symbol" text DEFAULT 'Rs' NOT NULL,
	"timezone" text DEFAULT 'Asia/Karachi' NOT NULL,
	"phone" text,
	"email" text,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"address" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "taxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rate" numeric(6, 3) NOT NULL,
	"is_inclusive" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"apply_by_default" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"branch_id" uuid,
	"role" "app_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "addon_groups" ADD CONSTRAINT "addon_groups_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addons" ADD CONSTRAINT "addons_group_id_addon_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."addon_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_printer_settings" ADD CONSTRAINT "branch_printer_settings_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_related_order_id_orders_id_fk" FOREIGN KEY ("related_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_related_purchase_id_inventory_purchases_id_fk" FOREIGN KEY ("related_purchase_id") REFERENCES "public"."inventory_purchases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_lines" ADD CONSTRAINT "inventory_purchase_lines_purchase_id_inventory_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."inventory_purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_lines" ADD CONSTRAINT "inventory_purchase_lines_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchases" ADD CONSTRAINT "inventory_purchases_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchases" ADD CONSTRAINT "inventory_purchases_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchases" ADD CONSTRAINT "inventory_purchases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_recipes" ADD CONSTRAINT "inventory_recipes_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_recipes" ADD CONSTRAINT "inventory_recipes_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_addon_groups" ADD CONSTRAINT "item_addon_groups_item_id_menu_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_addon_groups" ADD CONSTRAINT "item_addon_groups_group_id_addon_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."addon_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_variants" ADD CONSTRAINT "item_variants_item_id_menu_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_id_menu_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."menu_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_hours" ADD CONSTRAINT "operating_hours_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_expense_categories" ADD CONSTRAINT "operational_expense_categories_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_expenses" ADD CONSTRAINT "operational_expenses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_expenses" ADD CONSTRAINT "operational_expenses_category_id_operational_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."operational_expense_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_expenses" ADD CONSTRAINT "operational_expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_counters" ADD CONSTRAINT "order_counters_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_addons" ADD CONSTRAINT "order_item_addons_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_addons" ADD CONSTRAINT "order_item_addons_addon_id_addons_id_fk" FOREIGN KEY ("addon_id") REFERENCES "public"."addons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_item_id_menu_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."menu_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_taxes" ADD CONSTRAINT "order_taxes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_taxes" ADD CONSTRAINT "order_taxes_tax_id_taxes_id_fk" FOREIGN KEY ("tax_id") REFERENCES "public"."taxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_credentials" ADD CONSTRAINT "password_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxes" ADD CONSTRAINT "taxes_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_restaurant_created_idx" ON "audit_log" USING btree ("restaurant_id","created_at");--> statement-breakpoint
CREATE INDEX "branch_printer_settings_updated_idx" ON "branch_printer_settings" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_restaurant_code_unique" ON "branches" USING btree ("restaurant_id","code");--> statement-breakpoint
CREATE INDEX "inventory_items_branch_idx" ON "inventory_items" USING btree ("branch_id","is_active","name");--> statement-breakpoint
CREATE INDEX "inventory_movements_branch_created_idx" ON "inventory_movements" USING btree ("branch_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_item_created_idx" ON "inventory_movements" USING btree ("inventory_item_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_order_idx" ON "inventory_movements" USING btree ("related_order_id");--> statement-breakpoint
CREATE INDEX "inventory_purchase_lines_purchase_idx" ON "inventory_purchase_lines" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "inventory_purchase_lines_item_idx" ON "inventory_purchase_lines" USING btree ("inventory_item_id");--> statement-breakpoint
CREATE INDEX "inventory_purchases_branch_idx" ON "inventory_purchases" USING btree ("branch_id","purchase_date");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_recipes_unique" ON "inventory_recipes" USING btree ("menu_item_id","inventory_item_id");--> statement-breakpoint
CREATE INDEX "inventory_recipes_menu_item_idx" ON "inventory_recipes" USING btree ("menu_item_id");--> statement-breakpoint
CREATE INDEX "menu_categories_branch_idx" ON "menu_categories" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "menu_items_branch_idx" ON "menu_items" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "menu_items_category_idx" ON "menu_items" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operating_hours_branch_weekday_unique" ON "operating_hours" USING btree ("branch_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_expense_categories_unique" ON "operational_expense_categories" USING btree ("branch_id","name");--> statement-breakpoint
CREATE INDEX "operational_expense_categories_branch_idx" ON "operational_expense_categories" USING btree ("branch_id","is_active","name");--> statement-breakpoint
CREATE INDEX "operational_expenses_branch_date_idx" ON "operational_expenses" USING btree ("branch_id","expense_date","status");--> statement-breakpoint
CREATE INDEX "operational_expenses_category_idx" ON "operational_expenses" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_order_no_unique" ON "orders" USING btree ("order_no");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_idempotency_key_unique" ON "orders" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_branch_created_idx" ON "orders" USING btree ("branch_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_hash_unique" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "suppliers_restaurant_idx" ON "suppliers" USING btree ("restaurant_id","is_active","name");--> statement-breakpoint
CREATE INDEX "taxes_restaurant_idx" ON "taxes" USING btree ("restaurant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_branch_unique" ON "user_roles" USING btree ("user_id","restaurant_id","branch_id","role") WHERE "user_roles"."branch_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_restaurant_unique" ON "user_roles" USING btree ("user_id","restaurant_id","role") WHERE "user_roles"."branch_id" is null;--> statement-breakpoint
CREATE INDEX "user_roles_scope_idx" ON "user_roles" USING btree ("user_id","restaurant_id","branch_id");--> statement-breakpoint
CREATE INDEX "user_roles_user_idx" ON "user_roles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");