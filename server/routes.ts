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

  // Add is_blocked column if not exists (migration)
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false`);
  } catch (err) {
    console.error("Migration warning: failed to add is_blocked column:", err);
  }

  // Start the bot
  const bot = setupBot(storage, app);

  // Apple Health HTTP webhook — called by iOS Shortcut (POST or GET)
  // iOS test mode sends POST without Content-Length (nginx rejects it),
  // so we also support GET with query params: ?steps=1000&active_calories=300
  const handleHealthSync = async (req: import("express").Request, res: import("express").Response) => {
    const token = req.params.token as string;

    const user = await storage.getUserByHealthSyncToken(token).catch(() => null);
    if (!user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // Accept data from JSON body (POST) or query params (GET / fallback)
    let data: Record<string, unknown>;
    if (req.method === "GET" || !req.body || Object.keys(req.body || {}).length === 0) {
      const steps = req.query.steps as string | undefined;
      const active_calories = req.query.active_calories as string | undefined;
      data = {};
      if (steps !== undefined) data.steps = Number(steps);
      if (active_calories !== undefined) data.active_calories = Number(active_calories);
    } else {
      data = req.body;
    }

    console.log("[health-sync]", req.method, "data:", JSON.stringify(data));

    const result = await processHealthData(bot, storage, user, data);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({ ok: true, saved: result.saved });
  };

  app.post("/api/health-sync/:token", handleHealthSync);
  app.get("/api/health-sync/:token", handleHealthSync);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  return httpServer;
}
