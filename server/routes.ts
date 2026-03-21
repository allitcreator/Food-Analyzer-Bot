import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupBot } from "./bot";
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

  // Start the bot
  setupBot(storage, app);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  const REPLIT_DEPLOYMENT_URL = process.env.REPLIT_DEPLOYMENT_URL;
  if (process.env.NODE_ENV === "production" && REPLIT_DEPLOYMENT_URL) {
    const keepAliveUrl = `https://${REPLIT_DEPLOYMENT_URL}/api/health`;
    setInterval(() => {
      fetch(keepAliveUrl).catch(() => {});
    }, 4 * 60 * 1000);
    console.log("Keep-alive ping enabled every 4 minutes");
  }

  return httpServer;
}
