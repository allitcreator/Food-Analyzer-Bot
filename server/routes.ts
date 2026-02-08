import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupBot } from "./bot";
import { api } from "@shared/routes";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Start the bot
  setupBot(storage);

  app.get(api.stats.get.path, async (req, res) => {
    // Hardcoded user ID 1 for web demo if no auth
    const userId = 1; 
    const today = new Date();
    
    const dailyStats = await storage.getDailyStats(userId, today);
    const weeklyStats = await storage.getWeeklyStats(userId);

    res.json({
      dailyCalories: dailyStats.calories,
      dailyProtein: dailyStats.protein,
      dailyFat: dailyStats.fat,
      dailyCarbs: dailyStats.carbs,
      weeklyCalories: weeklyStats
    });
  });

  app.get(api.logs.list.path, async (req, res) => {
    const userId = 1; 
    const logs = await storage.getFoodLogs(userId);
    res.json(logs);
  });

  app.post(api.logs.create.path, async (req, res) => {
    try {
      const input = api.logs.create.input.parse(req.body);
      const userId = 1;
      
      const log = await storage.createFoodLog({ ...input, userId });
      res.status(201).json(log);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
      } else {
        res.status(500).json({ message: "Internal Server Error" });
      }
    }
  });

  // Seed demo data if needed
  const user = await storage.getUser(1);
  if (!user) {
    await storage.createUser({ telegramId: "demo", username: "demo_user" });
    await storage.createFoodLog({
      userId: 1,
      foodName: "Oatmeal with berries",
      calories: 350,
      protein: 12,
      fat: 6,
      carbs: 60,
      weight: 250,
      mealType: "breakfast"
    });
     await storage.createFoodLog({
      userId: 1,
      foodName: "Grilled Chicken Salad",
      calories: 450,
      protein: 40,
      fat: 15,
      carbs: 10,
      weight: 300,
      mealType: "lunch"
    });
  }

  return httpServer;
}
