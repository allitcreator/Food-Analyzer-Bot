-- Global self-filling barcode → product cache (idempotent).
-- Safe to run against BOTH a fresh database and an existing one, and safe to
-- re-apply (migtest runs the whole chain twice) — the guard makes it a no-op.
CREATE TABLE IF NOT EXISTS "barcode_products" (
	"barcode" text PRIMARY KEY NOT NULL,
	"food_name" text NOT NULL,
	"calories_per_100" real NOT NULL,
	"protein_per_100" real NOT NULL,
	"fat_per_100" real NOT NULL,
	"carbs_per_100" real NOT NULL,
	"default_weight" integer NOT NULL,
	"hydrating" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
