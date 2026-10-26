import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupBot } from "./bot";
import { createAppApiRouter } from "./app-api";
import { createQuickRouter } from "./quick-api";
import type { QueryConfig } from "pg";
import { pool } from "./db";
import { createHealthHandler } from "./lib/health";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Schema changes are handled by versioned migrations (migrations/*.sql) applied
  // at container startup via `drizzle-kit migrate` in docker-entrypoint.sh.

  // Start the bot (loads persisted session state before registering handlers)
  await setupBot(storage, app);

  // Живость процесса и базы: docker HEALTHCHECK и внешний мониторинг.
  // query_timeout освобождает клиента пула, если Postgres завис (pg его
  // поддерживает, но в @types/pg поля нет); общий таймаут хендлера покрывает
  // ещё и ожидание свободного соединения.
  const healthQuery: QueryConfig & { query_timeout: number } = {
    text: "SELECT 1",
    query_timeout: 2000,
  };
  app.get(
    "/api/health",
    createHealthHandler(() => pool.query(healthQuery), 3000),
  );

  // Telegram Mini App REST API (auth + rate-limit are applied inside the router).
  app.use("/api/app", createAppApiRouter());

  // Быстрая запись с телефона: шорткат iOS шлёт сюда еду с Bearer-токеном.
  // Монтируется ПОСЛЕ setupBot — роутер вбрасывает апдейты в живой бот.
  app.use("/api/quick", createQuickRouter());

  return httpServer;
}
