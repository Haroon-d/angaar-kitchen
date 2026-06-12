ALTER TABLE "menu_items"
  ADD COLUMN IF NOT EXISTS "is_best_seller" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "is_chef_recommended" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "is_popular" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "is_new_item" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "spice_level" text,
  ADD COLUMN IF NOT EXISTS "serving_size" text;

CREATE TABLE IF NOT EXISTS "homepage_promotions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL,
  "title" text NOT NULL,
  "subtitle" text,
  "description" text,
  "image_url" text,
  "cta_text" text DEFAULT 'Order now' NOT NULL,
  "cta_link" text DEFAULT '#order' NOT NULL,
  "start_date" timestamp with time zone,
  "end_date" timestamp with time zone,
  "priority" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'homepage_promotions_restaurant_id_restaurants_id_fk'
  ) THEN
    ALTER TABLE "homepage_promotions"
      ADD CONSTRAINT "homepage_promotions_restaurant_id_restaurants_id_fk"
      FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'homepage_promotions_created_by_users_id_fk'
  ) THEN
    ALTER TABLE "homepage_promotions"
      ADD CONSTRAINT "homepage_promotions_created_by_users_id_fk"
      FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "homepage_promotions_restaurant_active_idx"
  ON "homepage_promotions" USING btree ("restaurant_id", "is_active", "priority");

CREATE TABLE IF NOT EXISTS "product_analytics_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL,
  "branch_id" uuid,
  "item_id" uuid,
  "event_type" text NOT NULL,
  "search_query" text,
  "session_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_analytics_events_restaurant_id_restaurants_id_fk'
  ) THEN
    ALTER TABLE "product_analytics_events"
      ADD CONSTRAINT "product_analytics_events_restaurant_id_restaurants_id_fk"
      FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_analytics_events_branch_id_branches_id_fk'
  ) THEN
    ALTER TABLE "product_analytics_events"
      ADD CONSTRAINT "product_analytics_events_branch_id_branches_id_fk"
      FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_analytics_events_item_id_menu_items_id_fk'
  ) THEN
    ALTER TABLE "product_analytics_events"
      ADD CONSTRAINT "product_analytics_events_item_id_menu_items_id_fk"
      FOREIGN KEY ("item_id") REFERENCES "public"."menu_items"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "product_analytics_restaurant_event_idx"
  ON "product_analytics_events" USING btree ("restaurant_id", "event_type", "created_at");

CREATE INDEX IF NOT EXISTS "product_analytics_item_event_idx"
  ON "product_analytics_events" USING btree ("item_id", "event_type", "created_at");

CREATE TABLE IF NOT EXISTS "customer_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL,
  "branch_id" uuid,
  "order_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "rating" integer NOT NULL,
  "review" text,
  "is_verified_purchase" boolean DEFAULT true NOT NULL,
  "is_approved" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "customer_reviews_rating_check" CHECK ("rating" >= 1 AND "rating" <= 5)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_reviews_restaurant_id_restaurants_id_fk'
  ) THEN
    ALTER TABLE "customer_reviews"
      ADD CONSTRAINT "customer_reviews_restaurant_id_restaurants_id_fk"
      FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_reviews_branch_id_branches_id_fk'
  ) THEN
    ALTER TABLE "customer_reviews"
      ADD CONSTRAINT "customer_reviews_branch_id_branches_id_fk"
      FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_reviews_order_id_orders_id_fk'
  ) THEN
    ALTER TABLE "customer_reviews"
      ADD CONSTRAINT "customer_reviews_order_id_orders_id_fk"
      FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_reviews_customer_id_customers_id_fk'
  ) THEN
    ALTER TABLE "customer_reviews"
      ADD CONSTRAINT "customer_reviews_customer_id_customers_id_fk"
      FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "customer_reviews_order_customer_unique"
  ON "customer_reviews" USING btree ("order_id", "customer_id");

CREATE INDEX IF NOT EXISTS "customer_reviews_restaurant_approved_idx"
  ON "customer_reviews" USING btree ("restaurant_id", "is_approved", "created_at");
