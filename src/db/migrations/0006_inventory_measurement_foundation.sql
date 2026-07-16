ALTER TABLE "inventory_items"
  ADD COLUMN IF NOT EXISTS "display_unit" text,
  ADD COLUMN IF NOT EXISTS "display_unit_factor" numeric(18, 6);

UPDATE "inventory_items"
SET
  "display_unit" = CASE "base_unit"::text
    WHEN 'g' THEN 'kg'
    WHEN 'ml' THEN 'l'
    ELSE 'piece'
  END,
  "display_unit_factor" = CASE "base_unit"::text
    WHEN 'g' THEN 1000
    WHEN 'ml' THEN 1000
    ELSE 1
  END
WHERE "display_unit" IS NULL OR "display_unit_factor" IS NULL;

ALTER TABLE "inventory_purchase_lines"
  ADD COLUMN IF NOT EXISTS "conversion_factor" numeric(18, 6),
  ALTER COLUMN "unit" TYPE text USING "unit"::text;

UPDATE "inventory_purchase_lines"
SET "conversion_factor" = COALESCE("pack_size", 1)
WHERE "conversion_factor" IS NULL;

ALTER TABLE "inventory_recipes"
  ADD COLUMN IF NOT EXISTS "recipe_mode" text DEFAULT 'per_item' NOT NULL,
  ADD COLUMN IF NOT EXISTS "entry_quantity" numeric(14, 3),
  ADD COLUMN IF NOT EXISTS "entry_unit" text,
  ADD COLUMN IF NOT EXISTS "conversion_factor" numeric(18, 6),
  ADD COLUMN IF NOT EXISTS "batch_yield" numeric(14, 3),
  ADD COLUMN IF NOT EXISTS "batch_entry_quantity" numeric(14, 3),
  ADD COLUMN IF NOT EXISTS "batch_entry_unit" text;

UPDATE "inventory_recipes" AS recipe
SET
  "recipe_mode" = COALESCE(recipe."recipe_mode", 'per_item'),
  "entry_quantity" = recipe."quantity",
  "entry_unit" = item."base_unit"::text,
  "conversion_factor" = 1,
  "batch_yield" = 1,
  "batch_entry_quantity" = recipe."quantity",
  "batch_entry_unit" = item."base_unit"::text
FROM "inventory_items" AS item
WHERE item."id" = recipe."inventory_item_id"
  AND (
    recipe."entry_quantity" IS NULL OR
    recipe."entry_unit" IS NULL OR
    recipe."conversion_factor" IS NULL OR
    recipe."batch_yield" IS NULL OR
    recipe."batch_entry_quantity" IS NULL OR
    recipe."batch_entry_unit" IS NULL
  );

ALTER TABLE "inventory_movements"
  ADD COLUMN IF NOT EXISTS "entered_quantity" numeric(14, 3),
  ADD COLUMN IF NOT EXISTS "entered_unit" text,
  ADD COLUMN IF NOT EXISTS "conversion_factor" numeric(18, 6);

UPDATE "inventory_movements" AS movement
SET
  "entered_quantity" = movement."quantity_delta",
  "entered_unit" = item."base_unit"::text,
  "conversion_factor" = 1
FROM "inventory_items" AS item
WHERE item."id" = movement."inventory_item_id"
  AND (movement."entered_quantity" IS NULL OR movement."entered_unit" IS NULL OR movement."conversion_factor" IS NULL);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_display_unit_factor_positive'
  ) THEN
    ALTER TABLE "inventory_items"
      ADD CONSTRAINT "inventory_items_display_unit_factor_positive"
      CHECK ("display_unit_factor" IS NULL OR "display_unit_factor" > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_recipes_conversion_factor_positive'
  ) THEN
    ALTER TABLE "inventory_recipes"
      ADD CONSTRAINT "inventory_recipes_conversion_factor_positive"
      CHECK ("conversion_factor" IS NULL OR "conversion_factor" > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_recipes_batch_yield_positive'
  ) THEN
    ALTER TABLE "inventory_recipes"
      ADD CONSTRAINT "inventory_recipes_batch_yield_positive"
      CHECK ("batch_yield" IS NULL OR "batch_yield" > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_recipes_recipe_mode_valid'
  ) THEN
    ALTER TABLE "inventory_recipes"
      ADD CONSTRAINT "inventory_recipes_recipe_mode_valid"
      CHECK ("recipe_mode" IN ('per_item', 'batch'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_purchase_lines_conversion_factor_positive'
  ) THEN
    ALTER TABLE "inventory_purchase_lines"
      ADD CONSTRAINT "inventory_purchase_lines_conversion_factor_positive"
      CHECK ("conversion_factor" IS NULL OR "conversion_factor" > 0);
  END IF;
END $$;
