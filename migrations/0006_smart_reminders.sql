-- Умные напоминания о пропущенном приёме пищи (idempotent).
-- Safe to run against BOTH a fresh database and an existing one, and safe to
-- re-apply (migtest runs the whole chain twice) — the column add is guarded.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "smart_reminders" boolean DEFAULT false NOT NULL;
