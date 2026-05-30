ALTER TABLE "orders" ADD COLUMN "kot_print_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "bill_print_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "receipt_print_count" integer DEFAULT 0 NOT NULL;