CREATE TABLE IF NOT EXISTS "job_posts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "title" text NOT NULL,
  "department" text,
  "location" text,
  "employment_type" text DEFAULT 'full_time' NOT NULL,
  "salary_range" text,
  "description" text,
  "requirements" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "job_posts_restaurant_active_idx"
  ON "job_posts" ("restaurant_id", "is_active", "sort_order");

CREATE TABLE IF NOT EXISTS "job_applications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restaurant_id" uuid NOT NULL REFERENCES "restaurants"("id") ON DELETE cascade,
  "job_post_id" uuid REFERENCES "job_posts"("id") ON DELETE set null,
  "applicant_name" text NOT NULL,
  "phone" text NOT NULL,
  "whatsapp" text,
  "email" text,
  "city" text,
  "experience" text,
  "expected_salary" text,
  "availability" text,
  "source" text,
  "message" text,
  "status" text DEFAULT 'new' NOT NULL,
  "admin_notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "job_applications_restaurant_status_idx"
  ON "job_applications" ("restaurant_id", "status", "created_at");

CREATE INDEX IF NOT EXISTS "job_applications_job_post_idx"
  ON "job_applications" ("job_post_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_applications_status_valid'
  ) THEN
    ALTER TABLE "job_applications"
      ADD CONSTRAINT "job_applications_status_valid"
      CHECK ("status" IN ('new', 'shortlisted', 'interview', 'hired', 'rejected'));
  END IF;
END $$;
