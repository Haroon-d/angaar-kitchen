CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"branch_id" uuid,
	"name" text,
	"primary_phone" text NOT NULL,
	"phone_normalized" text NOT NULL,
	"email" text,
	"default_address" text,
	"notes" text,
	"spice_preference" text,
	"is_vip" boolean DEFAULT false NOT NULL,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"first_order_at" timestamp with time zone,
	"last_order_at" timestamp with time zone,
	"total_orders" integer DEFAULT 0 NOT NULL,
	"total_spent" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"label" text DEFAULT 'Delivery' NOT NULL,
	"address" text NOT NULL,
	"area" text,
	"city" text,
	"instructions" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_id" uuid;
--> statement-breakpoint
WITH normalized_orders AS (
	SELECT
		o.id,
		o.branch_id,
		b.restaurant_id,
		o.customer_name,
		o.customer_phone,
		o.created_at,
		o.grand_total,
		o.status,
		o.payment_status,
		CASE
			WHEN length(regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g')) = 11
				AND regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g') LIKE '0%'
				THEN '92' || substring(regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g') from 2)
			WHEN length(regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g')) = 10
				AND regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g') LIKE '3%'
				THEN '92' || regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g')
			ELSE regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g')
		END AS phone_normalized
	FROM "orders" o
	JOIN "branches" b ON b.id = o.branch_id
	WHERE coalesce(o.customer_phone, '') <> ''
),
customer_rollup AS (
	SELECT
		restaurant_id,
		phone_normalized,
		(array_agg(branch_id ORDER BY created_at DESC))[1] AS branch_id,
		(array_agg(nullif(customer_name, '') ORDER BY created_at DESC))[1] AS name,
		(array_agg(customer_phone ORDER BY created_at DESC))[1] AS primary_phone,
		min(created_at) FILTER (WHERE status NOT IN ('cancelled', 'voided', 'refunded')) AS first_order_at,
		max(created_at) FILTER (WHERE status NOT IN ('cancelled', 'voided', 'refunded')) AS last_order_at,
		count(*) FILTER (WHERE status NOT IN ('cancelled', 'voided', 'refunded'))::integer AS total_orders,
		coalesce(sum(grand_total) FILTER (WHERE status = 'completed' AND payment_status = 'paid'), 0)::numeric(14, 2) AS total_spent
	FROM normalized_orders
	WHERE phone_normalized <> ''
	GROUP BY restaurant_id, phone_normalized
)
INSERT INTO "customers" (
	"restaurant_id",
	"branch_id",
	"name",
	"primary_phone",
	"phone_normalized",
	"first_order_at",
	"last_order_at",
	"total_orders",
	"total_spent"
)
SELECT
	restaurant_id,
	branch_id,
	name,
	primary_phone,
	phone_normalized,
	first_order_at,
	last_order_at,
	total_orders,
	total_spent
FROM customer_rollup;
--> statement-breakpoint
CREATE TABLE "customer_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"branch_id" uuid,
	"order_id" uuid,
	"event_type" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
WITH normalized_orders AS (
	SELECT
		o.id,
		b.restaurant_id,
		CASE
			WHEN length(regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g')) = 11
				AND regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g') LIKE '0%'
				THEN '92' || substring(regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g') from 2)
			WHEN length(regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g')) = 10
				AND regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g') LIKE '3%'
				THEN '92' || regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g')
			ELSE regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g')
		END AS phone_normalized
	FROM "orders" o
	JOIN "branches" b ON b.id = o.branch_id
	WHERE coalesce(o.customer_phone, '') <> ''
)
UPDATE "orders" o
SET "customer_id" = c.id
FROM normalized_orders no
JOIN "customers" c
	ON c.restaurant_id = no.restaurant_id
	AND c.phone_normalized = no.phone_normalized
WHERE o.id = no.id
	AND no.phone_normalized <> '';
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_events" ADD CONSTRAINT "customer_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_events" ADD CONSTRAINT "customer_events_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_events" ADD CONSTRAINT "customer_events_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_events" ADD CONSTRAINT "customer_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "customers_restaurant_phone_unique" ON "customers" USING btree ("restaurant_id", "phone_normalized");
--> statement-breakpoint
CREATE INDEX "customers_restaurant_last_order_idx" ON "customers" USING btree ("restaurant_id", "last_order_at");
--> statement-breakpoint
CREATE INDEX "customers_branch_last_order_idx" ON "customers" USING btree ("branch_id", "last_order_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_addresses_customer_address_unique" ON "customer_addresses" USING btree ("customer_id", "address");
--> statement-breakpoint
CREATE INDEX "customer_addresses_customer_idx" ON "customer_addresses" USING btree ("customer_id");
--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");
--> statement-breakpoint
CREATE INDEX "customer_events_customer_created_idx" ON "customer_events" USING btree ("customer_id", "created_at");
--> statement-breakpoint
CREATE INDEX "customer_events_restaurant_created_idx" ON "customer_events" USING btree ("restaurant_id", "created_at");
