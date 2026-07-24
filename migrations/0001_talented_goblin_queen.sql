ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_health_sync_token_unique";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "health_sync_token";
