-- Персональный токен быстрой записи с iPhone (шорткат → POST /api/quick).
-- Прямой аналог снесённого health_sync_token, но токен ездит в заголовке
-- Authorization, а не в URL — прошлый аудит поймал утечку токена в nginx
-- access-логи. Idempotent: migtest прогоняет всю цепочку дважды.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "quick_token" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_quick_token_unique'
  ) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_quick_token_unique" UNIQUE ("quick_token");
  END IF;
END $$;
