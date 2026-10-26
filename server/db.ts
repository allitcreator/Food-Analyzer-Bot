import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { config } from "./config";
import { describeError } from "./lib/safe-log";

const { Pool } = pg;

export const pool = new Pool({ connectionString: config.databaseUrl });

// Простаивающий клиент пула получает ошибку, когда Postgres перезапускается
// или рвёт соединение. Без слушателя `error` pg бросает `Unhandled 'error'
// event` и процесс падает (прод, 2026-10-23). Пул сам выкинет битый клиент и
// создаст новый при следующем запросе — достаточно залогировать.
pool.on("error", (err) => {
  console.error("Postgres pool error (idle client):", describeError(err));
});

export const db = drizzle(pool, { schema });
