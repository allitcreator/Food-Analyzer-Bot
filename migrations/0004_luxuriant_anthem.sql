-- Favorites sharing: a favorite can be shared to all users (idempotent).
-- Safe to run against BOTH a fresh database and an existing one, and safe to
-- re-apply (migtest runs the whole chain twice) — the column add is guarded.
ALTER TABLE "favorites" ADD COLUMN IF NOT EXISTS "is_shared" boolean DEFAULT false NOT NULL;
