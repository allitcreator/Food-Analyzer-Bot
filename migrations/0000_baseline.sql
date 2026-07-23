-- Baseline migration (idempotent).
-- Safe to run against BOTH a fresh database and an existing production DB
-- that was previously provisioned via `drizzle-kit push`.
-- Every statement is guarded so re-application is a no-op.

CREATE TABLE IF NOT EXISTS "food_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"food_name" text NOT NULL,
	"calories" integer NOT NULL,
	"protein" integer NOT NULL,
	"fat" integer NOT NULL,
	"carbs" integer NOT NULL,
	"weight" integer NOT NULL,
	"meal_type" text NOT NULL,
	"food_score" integer,
	"nutrition_advice" text,
	"fiber" real,
	"sugar" real,
	"sodium" real,
	"saturated_fat" real,
	"date" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_id" text,
	"username" text,
	"is_approved" boolean DEFAULT false,
	"is_admin" boolean DEFAULT false,
	"is_blocked" boolean DEFAULT false,
	"age" integer,
	"gender" text,
	"weight" integer,
	"height" integer,
	"activity_level" text,
	"goal" text,
	"calories_goal" integer,
	"protein_goal" integer,
	"fat_goal" integer,
	"carbs_goal" integer,
	"report_time" text DEFAULT '21:00',
	"breakfast_reminder" text DEFAULT 'off',
	"lunch_reminder" text DEFAULT 'off',
	"dinner_reminder" text DEFAULT 'off',
	"no_log_reminder_time" text DEFAULT 'off',
	"weight_reminder_time" text DEFAULT 'off',
	"weight_reminder_days" text DEFAULT '',
	"show_micronutrients" boolean DEFAULT false,
	"ai_week_analysis" boolean DEFAULT true,
	"ai_month_analysis" boolean DEFAULT true,
	"ai_evening_report" boolean DEFAULT true,
	"smart_food_grouping" boolean DEFAULT true,
	"barcode_scan_enabled" boolean DEFAULT true,
	"timezone" text DEFAULT 'Europe/Moscow',
	"meal_breakfast_end" text DEFAULT '12:30',
	"meal_lunch_end" text DEFAULT '16:30',
	"health_sync_token" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id"),
	CONSTRAINT "users_health_sync_token_unique" UNIQUE("health_sync_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "water_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"date" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "weight_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"weight" real NOT NULL,
	"date" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workout_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"description" text NOT NULL,
	"workout_type" text NOT NULL,
	"duration_min" integer,
	"calories_burned" integer NOT NULL,
	"source" text DEFAULT 'manual',
	"date" timestamp DEFAULT now()
);
--> statement-breakpoint

-- Columns that used to be managed by the ad-hoc ALTERs in server/routes.ts.
-- On a fresh DB the CREATE TABLE above already covers them; on an existing DB
-- these guarantee the columns exist before the app relies on them.
ALTER TABLE "users" DROP COLUMN IF EXISTS "health_token";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "health_sync_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ai_week_analysis" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ai_month_analysis" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ai_evening_report" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_blocked" boolean DEFAULT false;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "users" ADD CONSTRAINT "users_health_sync_token_unique" UNIQUE("health_sync_token");
EXCEPTION WHEN duplicate_object THEN null; WHEN duplicate_table THEN null;
END $$;--> statement-breakpoint

-- Remove orphaned rows before enforcing NOT NULL on user_id (existing DBs only).
DELETE FROM "food_logs" WHERE "user_id" IS NULL;--> statement-breakpoint
DELETE FROM "water_logs" WHERE "user_id" IS NULL;--> statement-breakpoint
DELETE FROM "weight_logs" WHERE "user_id" IS NULL;--> statement-breakpoint
DELETE FROM "workout_logs" WHERE "user_id" IS NULL;--> statement-breakpoint

-- Enforce NOT NULL on user_id (no-op if already set).
ALTER TABLE "food_logs" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "water_logs" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "weight_logs" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_logs" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint

-- (Re)create FK constraints with ON DELETE CASCADE.
-- Drop any pre-existing FK (created by push with NO ACTION) then add the cascade one.
ALTER TABLE "food_logs" DROP CONSTRAINT IF EXISTS "food_logs_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "water_logs" DROP CONSTRAINT IF EXISTS "water_logs_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "weight_logs" DROP CONSTRAINT IF EXISTS "weight_logs_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "workout_logs" DROP CONSTRAINT IF EXISTS "workout_logs_user_id_users_id_fk";--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "food_logs" ADD CONSTRAINT "food_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "water_logs" ADD CONSTRAINT "water_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "weight_logs" ADD CONSTRAINT "weight_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workout_logs" ADD CONSTRAINT "workout_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "food_logs_user_id_date_idx" ON "food_logs" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "water_logs_user_id_date_idx" ON "water_logs" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "weight_logs_user_id_date_idx" ON "weight_logs" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workout_logs_user_id_date_idx" ON "workout_logs" USING btree ("user_id","date");
