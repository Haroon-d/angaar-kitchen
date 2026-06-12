CREATE TYPE "public"."coupon_discount_type" AS ENUM('amount', 'percent', 'free_delivery');
--> statement-breakpoint
CREATE TYPE "public"."coupon_applies_to" AS ENUM('both', 'pos', 'website');
--> statement-breakpoint
CREATE TABLE "coupon_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"discount_type" "coupon_discount_type" NOT NULL,
	"discount_value" numeric(12, 2) NOT NULL,
	"max_discount" numeric(12, 2),
	"min_order_total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"usage_limit" integer,
	"per_customer_limit" integer DEFAULT 1 NOT NULL,
	"applies_to" "coupon_applies_to" DEFAULT 'both' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon_id" uuid;
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "delivery_fee" numeric(12, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_fee" numeric(12, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"customer_id" uuid,
	"restaurant_id" uuid NOT NULL,
	"branch_id" uuid,
	"code_snapshot" text NOT NULL,
	"discount_amount" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coupon_campaigns" ADD CONSTRAINT "coupon_campaigns_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "coupon_campaigns" ADD CONSTRAINT "coupon_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_id_coupon_campaigns_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupon_campaigns"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupon_campaigns_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupon_campaigns"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_campaigns_restaurant_code_unique" ON "coupon_campaigns" USING btree ("restaurant_id", "code");
--> statement-breakpoint
CREATE INDEX "coupon_campaigns_restaurant_active_idx" ON "coupon_campaigns" USING btree ("restaurant_id", "is_active");
--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_redemptions_coupon_order_unique" ON "coupon_redemptions" USING btree ("coupon_id", "order_id");
--> statement-breakpoint
CREATE INDEX "coupon_redemptions_coupon_idx" ON "coupon_redemptions" USING btree ("coupon_id");
--> statement-breakpoint
CREATE INDEX "coupon_redemptions_customer_idx" ON "coupon_redemptions" USING btree ("customer_id");
--> statement-breakpoint
CREATE INDEX "coupon_redemptions_restaurant_created_idx" ON "coupon_redemptions" USING btree ("restaurant_id", "created_at");
