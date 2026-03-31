import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupBot, processHealthData } from "./bot";
import { pool } from "./db";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Drop health_token column if it still exists (migration from old webhook approach)
  try {
    await pool.query(`ALTER TABLE users DROP COLUMN IF EXISTS health_token`);
  } catch (err) {
    console.error("Migration warning: failed to drop health_token column:", err);
  }

  // Add health_sync_token column if not exists (migration)
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS health_sync_token TEXT UNIQUE`);
  } catch (err) {
    console.error("Migration warning: failed to add health_sync_token column:", err);
  }

  // Start the bot
  const bot = setupBot(storage, app);

  // Apple Health HTTP webhook — called by iOS Shortcut in the background
  app.post("/api/health-sync/:token", async (req, res) => {
    const { token } = req.params;

    const user = await storage.getUserByHealthSyncToken(token).catch(() => null);
    if (!user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const body = req.body;
    console.log("[health-sync] body received:", JSON.stringify(body));

    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    const result = await processHealthData(bot, storage, user, body);
    if (!result.ok) {
      console.log("[health-sync] parse error:", result.error, "| keys in body:", Object.keys(body));
      return res.status(400).json({ error: result.error, received_keys: Object.keys(body) });
    }

    return res.json({ ok: true, saved: result.saved });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  return httpServer;
}
