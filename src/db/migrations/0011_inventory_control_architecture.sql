ALTER TABLE "branches"
  ADD COLUMN IF NOT EXISTS "inventory_locked_before" timestamp with time zone;

CREATE TABLE IF NOT EXISTS "inventory_unit_conversions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "inventory_item_id" uuid NOT NULL REFERENCES "inventory_items"("id") ON DELETE cascade,
  "unit" text NOT NULL,
  "base_quantity" numeric(18, 6) NOT NULL,
  "label" text,
  "is_default_purchase" boolean DEFAULT false NOT NULL,
  "is_default_recipe" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_unit_conversions_item_unit_unique"
  ON "inventory_unit_conversions" ("inventory_item_id", "unit");
CREATE INDEX IF NOT EXISTS "inventory_unit_conversions_item_idx"
  ON "inventory_unit_conversions" ("inventory_item_id");

CREATE TABLE IF NOT EXISTS "inventory_cost_layers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE cascade,
  "inventory_item_id" uuid NOT NULL REFERENCES "inventory_items"("id") ON DELETE restrict,
  "source_purchase_line_id" uuid REFERENCES "inventory_purchase_lines"("id") ON DELETE set null,
  "source_movement_id" uuid REFERENCES "inventory_movements"("id") ON DELETE set null,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "quantity_received" numeric(14, 3) NOT NULL,
  "quantity_remaining" numeric(14, 3) NOT NULL,
  "unit_cost" numeric(14, 6) DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "inventory_cost_layers_fifo_idx"
  ON "inventory_cost_layers" ("branch_id", "inventory_item_id", "received_at", "created_at");
CREATE INDEX IF NOT EXISTS "inventory_cost_layers_remaining_idx"
  ON "inventory_cost_layers" ("inventory_item_id", "quantity_remaining");

CREATE TABLE IF NOT EXISTS "inventory_fifo_consumptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE cascade,
  "inventory_item_id" uuid NOT NULL REFERENCES "inventory_items"("id") ON DELETE restrict,
  "movement_id" uuid NOT NULL REFERENCES "inventory_movements"("id") ON DELETE cascade,
  "cost_layer_id" uuid REFERENCES "inventory_cost_layers"("id") ON DELETE set null,
  "quantity" numeric(14, 3) NOT NULL,
  "unit_cost" numeric(14, 6) DEFAULT 0 NOT NULL,
  "total_cost" numeric(14, 2) DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "inventory_fifo_consumptions_movement_idx"
  ON "inventory_fifo_consumptions" ("movement_id");
CREATE INDEX IF NOT EXISTS "inventory_fifo_consumptions_layer_idx"
  ON "inventory_fifo_consumptions" ("cost_layer_id");

CREATE TABLE IF NOT EXISTS "inventory_counts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE cascade,
  "count_date" date NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "notes" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "applied_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "applied_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "inventory_counts_branch_date_idx"
  ON "inventory_counts" ("branch_id", "count_date");
CREATE INDEX IF NOT EXISTS "inventory_counts_branch_status_idx"
  ON "inventory_counts" ("branch_id", "status");

CREATE TABLE IF NOT EXISTS "inventory_count_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "count_id" uuid NOT NULL REFERENCES "inventory_counts"("id") ON DELETE cascade,
  "inventory_item_id" uuid NOT NULL REFERENCES "inventory_items"("id") ON DELETE restrict,
  "system_qty" numeric(14, 3) NOT NULL,
  "counted_quantity" numeric(14, 3) NOT NULL,
  "counted_unit" text NOT NULL,
  "conversion_factor" numeric(18, 6),
  "counted_base_qty" numeric(14, 3) NOT NULL,
  "variance_qty" numeric(14, 3) NOT NULL,
  "unit_cost" numeric(14, 6) DEFAULT 0 NOT NULL,
  "variance_value" numeric(14, 2) DEFAULT 0 NOT NULL,
  "adjustment_movement_id" uuid REFERENCES "inventory_movements"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_count_lines_unique"
  ON "inventory_count_lines" ("count_id", "inventory_item_id");
CREATE INDEX IF NOT EXISTS "inventory_count_lines_item_idx"
  ON "inventory_count_lines" ("inventory_item_id");

CREATE TABLE IF NOT EXISTS "supplier_ledger_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "branch_id" uuid REFERENCES "branches"("id") ON DELETE cascade,
  "supplier_id" uuid NOT NULL REFERENCES "suppliers"("id") ON DELETE cascade,
  "entry_type" text NOT NULL,
  "purchase_id" uuid REFERENCES "inventory_purchases"("id") ON DELETE set null,
  "amount" numeric(14, 2) NOT NULL,
  "reference_no" text,
  "occurred_on" date NOT NULL,
  "notes" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "supplier_ledger_supplier_date_idx"
  ON "supplier_ledger_entries" ("supplier_id", "occurred_on");
CREATE INDEX IF NOT EXISTS "supplier_ledger_branch_date_idx"
  ON "supplier_ledger_entries" ("branch_id", "occurred_on");

INSERT INTO "inventory_cost_layers"
  ("branch_id", "inventory_item_id", "source_purchase_line_id", "received_at",
   "quantity_received", "quantity_remaining", "unit_cost")
SELECT
  p."branch_id",
  l."inventory_item_id",
  l."id",
  p."purchase_date"::timestamp at time zone 'Asia/Karachi',
  l."base_quantity",
  l."base_quantity",
  CASE WHEN l."base_quantity"::numeric > 0
    THEN (l."line_total"::numeric / l."base_quantity"::numeric)
    ELSE 0
  END
FROM "inventory_purchase_lines" l
JOIN "inventory_purchases" p ON p."id" = l."purchase_id"
WHERE NOT EXISTS (
  SELECT 1
  FROM "inventory_cost_layers" layer
  WHERE layer."source_purchase_line_id" = l."id"
);

DO $$
DECLARE
  item_record record;
  layer_record record;
  remaining numeric;
  keep_qty numeric;
BEGIN
  FOR item_record IN
    SELECT "id", GREATEST("current_qty"::numeric, 0) AS "current_qty"
    FROM "inventory_items"
  LOOP
    remaining := item_record."current_qty";

    UPDATE "inventory_cost_layers"
    SET "quantity_remaining" = 0
    WHERE "inventory_item_id" = item_record."id";

    FOR layer_record IN
      SELECT "id", "quantity_received"
      FROM "inventory_cost_layers"
      WHERE "inventory_item_id" = item_record."id"
      ORDER BY "received_at" DESC, "created_at" DESC, "id" DESC
    LOOP
      EXIT WHEN remaining <= 0;
      keep_qty := LEAST(layer_record."quantity_received"::numeric, remaining);
      UPDATE "inventory_cost_layers"
      SET "quantity_remaining" = keep_qty
      WHERE "id" = layer_record."id";
      remaining := remaining - keep_qty;
    END LOOP;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION prevent_inventory_movement_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'inventory_movements is an immutable ledger; post a correction movement instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "inventory_movements_no_update" ON "inventory_movements";
CREATE TRIGGER "inventory_movements_no_update"
  BEFORE UPDATE ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION prevent_inventory_movement_mutation();

DROP TRIGGER IF EXISTS "inventory_movements_no_delete" ON "inventory_movements";
CREATE TRIGGER "inventory_movements_no_delete"
  BEFORE DELETE ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION prevent_inventory_movement_mutation();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_unit_conversions_base_quantity_positive'
  ) THEN
    ALTER TABLE "inventory_unit_conversions"
      ADD CONSTRAINT "inventory_unit_conversions_base_quantity_positive"
      CHECK ("base_quantity" > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_cost_layers_quantities_valid'
  ) THEN
    ALTER TABLE "inventory_cost_layers"
      ADD CONSTRAINT "inventory_cost_layers_quantities_valid"
      CHECK ("quantity_received" >= 0 AND "quantity_remaining" >= 0 AND "quantity_remaining" <= "quantity_received");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_fifo_consumptions_quantity_positive'
  ) THEN
    ALTER TABLE "inventory_fifo_consumptions"
      ADD CONSTRAINT "inventory_fifo_consumptions_quantity_positive"
      CHECK ("quantity" > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_counts_status_valid'
  ) THEN
    ALTER TABLE "inventory_counts"
      ADD CONSTRAINT "inventory_counts_status_valid"
      CHECK ("status" IN ('draft', 'applied', 'void'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'supplier_ledger_entry_type_valid'
  ) THEN
    ALTER TABLE "supplier_ledger_entries"
      ADD CONSTRAINT "supplier_ledger_entry_type_valid"
      CHECK ("entry_type" IN ('purchase', 'payment', 'credit', 'adjustment'));
  END IF;
END $$;
