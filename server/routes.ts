import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupBot, sendAppleHealthConfirmation } from "./bot";
import { api } from "@shared/routes";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Start the bot
  setupBot(storage, app);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  const appleHealthSchema = z.object({
    token: z.string().min(1),
    steps: z.number().int().min(0).optional(),
    active_calories: z.number().int().min(0).optional(),
    workouts: z.array(z.object({
      type: z.string(),
      duration_min: z.number().int().min(0).optional(),
      calories: z.number().int().min(0),
    })).optional(),
  });

  app.post("/api/health/apple", async (req, res) => {
    const parsed = appleHealthSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const { token, steps, active_calories, workouts } = parsed.data;

    const user = await storage.getUserByHealthToken(token);
    if (!user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const today = new Date();

    await storage.deleteWorkoutLogsBySource(user.id, today, "apple_health");

    const savedEntries: string[] = [];

    if (workouts && workouts.length > 0) {
      for (const w of workouts) {
        await storage.createWorkoutLog({
          userId: user.id,
          description: w.duration_min ? `${w.type} ${w.duration_min} мин` : w.type,
          workoutType: w.type.toLowerCase(),
          durationMin: w.duration_min ?? null,
          caloriesBurned: w.calories,
          source: "apple_health",
        });
        const label = w.duration_min ? `${w.type} ${w.duration_min} мин — ${w.calories} ккал` : `${w.type} — ${w.calories} ккал`;
        savedEntries.push(label);
      }
    }

    if (steps && steps > 0) {
      const stepsCalories = active_calories && workouts && workouts.length > 0
        ? Math.max(0, active_calories - (workouts.reduce((s, w) => s + w.calories, 0)))
        : (active_calories ?? Math.round(steps * 0.04));

      if (stepsCalories > 0) {
        await storage.createWorkoutLog({
          userId: user.id,
          description: `${steps.toLocaleString('ru-RU')} шагов`,
          workoutType: "шаги",
          durationMin: null,
          caloriesBurned: stepsCalories,
          source: "apple_health",
        });
        savedEntries.push(`${steps.toLocaleString('ru-RU')} шагов — ${stepsCalories} ккал`);
      }
    }

    if (savedEntries.length === 0) {
      return res.json({ ok: true, message: "No activity to log" });
    }

    await sendAppleHealthConfirmation(user.telegramId!, savedEntries);

    return res.json({ ok: true, logged: savedEntries.length });
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
