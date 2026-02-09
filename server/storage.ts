import { users, foodLogs, type User, type InsertUser, type FoodLog, type InsertFoodLog } from "@shared/schema";
import { db } from "./db";
import { eq, sql, desc, gte, lt } from "drizzle-orm";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByTelegramId(telegramId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createFoodLog(log: InsertFoodLog): Promise<FoodLog>;
  getFoodLogs(userId: number): Promise<FoodLog[]>;
  getDailyStats(userId: number, date: Date): Promise<{
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
  }>;
  getWeeklyStats(userId: number): Promise<{ date: string; calories: number }[]>;
  getFoodLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<FoodLog[]>;
  deleteFoodLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByTelegramId(telegramId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser;
  }

  async createFoodLog(log: InsertFoodLog): Promise<FoodLog> {
    const [newLog] = await db.insert(foodLogs).values(log).returning();
    return newLog;
  }

  async getFoodLogs(userId: number): Promise<FoodLog[]> {
    return db.select().from(foodLogs)
      .where(eq(foodLogs.userId, userId))
      .orderBy(desc(foodLogs.date));
  }

  async getDailyStats(userId: number, date: Date) {
    // Start of day
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    // End of day
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const logs = await db.select().from(foodLogs)
      .where(
        sql`${foodLogs.userId} = ${userId} AND ${foodLogs.date} >= ${start} AND ${foodLogs.date} <= ${end}`
      );

    return logs.reduce((acc, log) => ({
      calories: acc.calories + log.calories,
      protein: acc.protein + log.protein,
      fat: acc.fat + log.fat,
      carbs: acc.carbs + log.carbs,
    }), { calories: 0, protein: 0, fat: 0, carbs: 0 });
  }

  async getWeeklyStats(userId: number) {
    // Last 7 days
    const stats = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const daily = await this.getDailyStats(userId, date);
      stats.push({
        date: date.toISOString().split('T')[0],
        calories: daily.calories
      });
    }
    return stats;
  }

  async getFoodLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<FoodLog[]> {
    return db.select().from(foodLogs)
      .where(
        sql`${foodLogs.userId} = ${userId} AND ${foodLogs.date} >= ${startDate} AND ${foodLogs.date} <= ${endDate}`
      )
      .orderBy(foodLogs.date);
  }

  async deleteFoodLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<void> {
    await db.delete(foodLogs)
      .where(
        sql`${foodLogs.userId} = ${userId} AND ${foodLogs.date} >= ${startDate} AND ${foodLogs.date} <= ${endDate}`
      );
  }
}

export const storage = new DatabaseStorage();
