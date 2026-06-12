ALTER TABLE "homepage_promotions"
  ADD COLUMN IF NOT EXISTS "action_type" text DEFAULT 'link' NOT NULL,
  ADD COLUMN IF NOT EXISTS "menu_item_id" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'homepage_promotions_menu_item_id_menu_items_id_fk'
  ) THEN
    ALTER TABLE "homepage_promotions"
      ADD CONSTRAINT "homepage_promotions_menu_item_id_menu_items_id_fk"
      FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "homepage_promotions_menu_item_idx"
  ON "homepage_promotions" USING btree ("menu_item_id");
