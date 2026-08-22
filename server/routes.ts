import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupBot } from "./bot";
import { createAppApiRouter } from "./app-api";
import { createQuickRouter } from "./quick-api";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Schema changes are handled by versioned migrations (migrations/*.sql) applied
  // at container startup via `drizzle-kit migrate` in docker-entrypoint.sh.

  // Start the bot (loads persisted session state before registering handlers)
  await setupBot(storage, app);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  // Telegram Mini App REST API (auth + rate-limit are applied inside the router).
  app.use("/api/app", createAppApiRouter());

  // Быстрая запись с телефона: шорткат iOS шлёт сюда еду с Bearer-токеном.
  // Монтируется ПОСЛЕ setupBot — роутер вбрасывает апдейты в живой бот.
  app.use("/api/quick", createQuickRouter());

  return httpServer;
}
