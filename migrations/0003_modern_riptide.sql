-- User favorites: saved meals/dishes for one-tap "repeat" (idempotent).
-- Safe to run against BOTH a fresh database and an existing one, and safe to
-- re-apply (migtest runs the whole chain twice) — every statement is guarded.
CREATE TABLE IF NOT EXISTS "favorites" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" text NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'favorites_user_id_users_id_fk'
	) THEN
		ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "favorites_user_id_idx" ON "favorites" USING btree ("user_id");
