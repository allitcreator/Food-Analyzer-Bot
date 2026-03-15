import { users, foodLogs, waterLogs, type User, type InsertUser, type FoodLog, type InsertFoodLog } from "@shared/schema";
import { db } from "./db";
import { eq, sql, desc, gte, lt } from "drizzle-orm";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByTelegramId(telegramId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, data: Partial<User>): Promise<User>;
  deleteUser(id: number): Promise<void>;
  getAllUsers(): Promise<User[]>;
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
  deleteFoodLog(id: number): Promise<void>;
  calculateAndSetGoals(userId: number): Promise<User>;
  logWater(userId: number, amount: number): Promise<void>;
  getDailyWater(userId: number, date: Date): Promise<number>;
  getAllApprovedUsers(): Promise<User[]>;
  updateUserReportTime(userId: number, time: string): Promise<void>;
  updateUserReminder(userId: number, meal: 'breakfast' | 'lunch' | 'dinner', time: string): Promise<void>;
  getStreak(userId: number): Promise<number>;
  getWeeklyFullStats(userId: number): Promise<{ date: string; dayLabel: string; calories: number; protein: number; fat: number; carbs: number }[]>;
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

  async updateUser(id: number, data: Partial<User>): Promise<User> {
    const [updatedUser] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return updatedUser;
  }

  async calculateAndSetGoals(userId: number): Promise<User> {
    const user = await this.getUser(userId);
    if (!user || !user.weight || !user.height || !user.age || !user.gender || !user.activityLevel || !user.goal) {
      return user!;
    }

    // Mifflin-St Jeor Equation
    let bmr = (10 * user.weight) + (6.25 * user.height) - (5 * user.age);
    if (user.gender === 'male') {
      bmr += 5;
    } else {
      bmr -= 161;
    }

    const activityMultipliers: Record<string, number> = {
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      active: 1.725,
      very_active: 1.9
    };

    let calories = Math.round(bmr * (activityMultipliers[user.activityLevel] || 1.2));

    if (user.goal === 'lose') {
      calories -= 500;
    } else if (user.goal === 'gain') {
      calories += 500;
    }

    // 30% Protein, 30% Fat, 40% Carbs
    const protein = Math.round((calories * 0.3) / 4);
    const fat = Math.round((calories * 0.3) / 9);
    const carbs = Math.round((calories * 0.4) / 4);

    return this.updateUser(userId, {
      caloriesGoal: calories,
      proteinGoal: protein,
      fatGoal: fat,
      carbsGoal: carbs
    });
  }

  async deleteUser(id: number): Promise<void> {
    await db.delete(foodLogs).where(eq(foodLogs.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
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

  async deleteFoodLog(id: number): Promise<void> {
    await db.delete(foodLogs).where(eq(foodLogs.id, id));
  }

  async logWater(userId: number, amount: number): Promise<void> {
    await db.insert(waterLogs).values({ userId, amount });
  }

  async getDailyWater(userId: number, date: Date): Promise<number> {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const logs = await db.select().from(waterLogs)
      .where(sql`${waterLogs.userId} = ${userId} AND ${waterLogs.date} >= ${start} AND ${waterLogs.date} <= ${end}`);

    return logs.reduce((sum, l) => sum + l.amount, 0);
  }

  async getAllApprovedUsers(): Promise<User[]> {
    return db.select().from(users).where(eq(users.isApproved, true));
  }

  async updateUserReportTime(userId: number, time: string): Promise<void> {
    await db.update(users).set({ reportTime: time }).where(eq(users.id, userId));
  }

  async updateUserReminder(userId: number, meal: 'breakfast' | 'lunch' | 'dinner', time: string): Promise<void> {
    const field = meal === 'breakfast' ? 'breakfastReminder' : meal === 'lunch' ? 'lunchReminder' : 'dinnerReminder';
    await db.update(users).set({ [field]: time }).where(eq(users.id, userId));
  }

  async getStreak(userId: number): Promise<number> {
    const today = new Date();
    const todayStats = await this.getDailyStats(userId, today);
    const startOffset = todayStats.calories > 0 ? 0 : 1;
    let streak = 0;
    for (let i = startOffset; i < 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const s = await this.getDailyStats(userId, d);
      if (s.calories > 0) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }

  async getWeeklyFullStats(userId: number): Promise<{ date: string; dayLabel: string; calories: number; protein: number; fat: number; carbs: number }[]> {
    const DAY_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const s = await this.getDailyStats(userId, d);
      const dd = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
      result.push({ date: d.toISOString().split('T')[0], dayLabel: `${DAY_RU[d.getDay()]} ${dd}`, ...s });
    }
    return result;
  }
}

export const storage = new DatabaseStorage();
