-- Persistent bot session state + at-most-once notification ledger (idempotent).
-- Safe to run against BOTH a fresh database and an existing one, and safe to
-- re-apply (migtest runs the whole chain twice) — every statement is guarded.
CREATE TABLE IF NOT EXISTS "bot_state" (
	"telegram_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bot_state_telegram_id_key_pk" PRIMARY KEY("telegram_id","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_sends" (
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"day_key" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_sends_user_id_kind_day_key_pk" PRIMARY KEY("user_id","kind","day_key")
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'notification_sends_user_id_users_id_fk'
	) THEN
		ALTER TABLE "notification_sends" ADD CONSTRAINT "notification_sends_user_id_users_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
