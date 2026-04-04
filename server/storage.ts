import { users, foodLogs, waterLogs, weightLogs, workoutLogs, type User, type InsertUser, type FoodLog, type InsertFoodLog, type WeightLog, type WorkoutLog, type InsertWorkoutLog } from "@shared/schema";
import { db } from "./db";
import { eq, sql, desc, gte, lt } from "drizzle-orm";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByTelegramId(telegramId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, data: Partial<User>): Promise<User>;
  deleteUser(id: number): Promise<void>;
  getAllUsers(): Promise<User[]>;
  getAllApprovedUsers(): Promise<User[]>;

  createFoodLog(log: InsertFoodLog): Promise<FoodLog>;
  getFoodLogs(userId: number): Promise<FoodLog[]>;
  getFoodLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<FoodLog[]>;
  deleteFoodLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<void>;
  deleteFoodLog(id: number): Promise<void>;
  updateFoodLog(id: number, data: Partial<InsertFoodLog>): Promise<FoodLog>;
  getFoodLogById(id: number): Promise<FoodLog | undefined>;

  getDailyStats(userId: number, date: Date): Promise<{ calories: number; protein: number; fat: number; carbs: number; fiber: number; sugar: number; sodium: number; saturatedFat: number }>;
  getWeeklyStats(userId: number): Promise<{ date: string; calories: number }[]>;
  getWeeklyFullStats(userId: number): Promise<{ date: string; dayLabel: string; calories: number; protein: number; fat: number; carbs: number }[]>;
  getMonthlyStats(userId: number): Promise<{ weekLabel: string; calories: number; protein: number; fat: number; carbs: number; days: number }[]>;
  getStreak(userId: number): Promise<number>;

  calculateAndSetGoals(userId: number): Promise<User>;
  updateUserReportTime(userId: number, time: string): Promise<void>;
  updateUserReminder(userId: number, meal: 'breakfast' | 'lunch' | 'dinner', time: string): Promise<void>;

  logWater(userId: number, amount: number): Promise<void>;
  getDailyWater(userId: number, date: Date): Promise<number>;

  logWeight(userId: number, weight: number): Promise<WeightLog>;
  getWeightLogs(userId: number, limit?: number): Promise<WeightLog[]>;
  getWeightLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<WeightLog[]>;

  createWorkoutLog(log: InsertWorkoutLog): Promise<WorkoutLog>;
  getDailyWorkouts(userId: number, date: Date): Promise<WorkoutLog[]>;
  getWorkoutLogs(userId: number, limit?: number): Promise<WorkoutLog[]>;
  deleteWorkoutLog(id: number): Promise<void>;
  deleteWorkoutLogsBySource(userId: number, date: Date, source: string): Promise<void>;

  getUserByHealthSyncToken(token: string): Promise<User | undefined>;
  setHealthSyncToken(userId: number, token: string): Promise<void>;
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

    let bmr = (10 * user.weight) + (6.25 * user.height) - (5 * user.age);
    bmr += user.gender === 'male' ? 5 : -161;

    const activityMultipliers: Record<string, number> = {
      sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9
    };

    let calories = Math.round(bmr * (activityMultipliers[user.activityLevel] || 1.2));
    if (user.goal === 'lose') calories -= 500;
    else if (user.goal === 'gain') calories += 500;

    const protein = Math.round((calories * 0.3) / 4);
    const fat = Math.round((calories * 0.3) / 9);
    const carbs = Math.round((calories * 0.4) / 4);

    return this.updateUser(userId, { caloriesGoal: calories, proteinGoal: protein, fatGoal: fat, carbsGoal: carbs });
  }

  async deleteUser(id: number): Promise<void> {
    await db.delete(foodLogs).where(eq(foodLogs.userId, id));
    await db.delete(weightLogs).where(eq(weightLogs.userId, id));
    await db.delete(workoutLogs).where(eq(workoutLogs.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  async getAllApprovedUsers(): Promise<User[]> {
    return db.select().from(users).where(eq(users.isApproved, true));
  }

  async createFoodLog(log: InsertFoodLog): Promise<FoodLog> {
    const [newLog] = await db.insert(foodLogs).values(log).returning();
    return newLog;
  }

  async getFoodLogs(userId: number): Promise<FoodLog[]> {
    return db.select().from(foodLogs).where(eq(foodLogs.userId, userId)).orderBy(desc(foodLogs.date));
  }

  async getDailyStats(userId: number, date: Date) {
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end = new Date(date); end.setHours(23, 59, 59, 999);

    const logs = await db.select().from(foodLogs).where(
      sql`${foodLogs.userId} = ${userId} AND ${foodLogs.date} >= ${start} AND ${foodLogs.date} <= ${end}`
    );

    return logs.reduce((acc, log) => ({
      calories: acc.calories + log.calories,
      protein: acc.protein + log.protein,
      fat: acc.fat + log.fat,
      carbs: acc.carbs + log.carbs,
      fiber: acc.fiber + (log.fiber ?? 0),
      sugar: acc.sugar + (log.sugar ?? 0),
      sodium: acc.sodium + (log.sodium ?? 0),
      saturatedFat: acc.saturatedFat + (log.saturatedFat ?? 0),
    }), { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0, sodium: 0, saturatedFat: 0 });
  }

  async getWeeklyStats(userId: number) {
    const stats = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(); date.setDate(date.getDate() - i);
      const daily = await this.getDailyStats(userId, date);
      stats.push({ date: date.toISOString().split('T')[0], calories: daily.calories });
    }
    return stats;
  }

  async getWeeklyFullStats(userId: number) {
    const DAY_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const s = await this.getDailyStats(userId, d);
      const dd = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
      result.push({ date: d.toISOString().split('T')[0], dayLabel: `${DAY_RU[d.getDay()]} ${dd}`, ...s });
    }
    return result;
  }

  async getMonthlyStats(userId: number) {
    const weeks: { weekLabel: string; calories: number; protein: number; fat: number; carbs: number; days: number }[] = [];
    const today = new Date();

    for (let w = 3; w >= 0; w--) {
      const weekEnd = new Date(today);
      weekEnd.setDate(today.getDate() - w * 7);
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekEnd.getDate() - 6);

      let totalCal = 0, totalProt = 0, totalFat = 0, totalCarbs = 0, activeDays = 0;

      for (let d = 0; d < 7; d++) {
        const day = new Date(weekStart);
        day.setDate(weekStart.getDate() + d);
        if (day > today) break;
        const s = await this.getDailyStats(userId, day);
        if (s.calories > 0) {
          totalCal += s.calories; totalProt += s.protein;
          totalFat += s.fat; totalCarbs += s.carbs;
          activeDays++;
        }
      }

      const startLabel = `${String(weekStart.getDate()).padStart(2, '0')}.${String(weekStart.getMonth() + 1).padStart(2, '0')}`;
      const endLabel = `${String(weekEnd.getDate()).padStart(2, '0')}.${String(weekEnd.getMonth() + 1).padStart(2, '0')}`;
      weeks.push({
        weekLabel: `${startLabel}–${endLabel}`,
        calories: activeDays > 0 ? Math.round(totalCal / activeDays) : 0,
        protein: activeDays > 0 ? Math.round(totalProt / activeDays) : 0,
        fat: activeDays > 0 ? Math.round(totalFat / activeDays) : 0,
        carbs: activeDays > 0 ? Math.round(totalCarbs / activeDays) : 0,
        days: activeDays,
      });
    }
    return weeks;
  }

  async getFoodLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<FoodLog[]> {
    return db.select().from(foodLogs).where(
      sql`${foodLogs.userId} = ${userId} AND ${foodLogs.date} >= ${startDate} AND ${foodLogs.date} <= ${endDate}`
    ).orderBy(foodLogs.date);
  }

  async deleteFoodLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<void> {
    await db.delete(foodLogs).where(
      sql`${foodLogs.userId} = ${userId} AND ${foodLogs.date} >= ${startDate} AND ${foodLogs.date} <= ${endDate}`
    );
  }

  async deleteFoodLog(id: number): Promise<void> {
    await db.delete(foodLogs).where(eq(foodLogs.id, id));
  }

  async updateFoodLog(id: number, data: Partial<InsertFoodLog>): Promise<FoodLog> {
    const [updated] = await db.update(foodLogs).set(data).where(eq(foodLogs.id, id)).returning();
    return updated;
  }

  async getFoodLogById(id: number): Promise<FoodLog | undefined> {
    const [log] = await db.select().from(foodLogs).where(eq(foodLogs.id, id));
    return log;
  }

  async logWater(userId: number, amount: number): Promise<void> {
    await db.insert(waterLogs).values({ userId, amount });
  }

  async getDailyWater(userId: number, date: Date): Promise<number> {
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end = new Date(date); end.setHours(23, 59, 59, 999);
    const logs = await db.select().from(waterLogs).where(
      sql`${waterLogs.userId} = ${userId} AND ${waterLogs.date} >= ${start} AND ${waterLogs.date} <= ${end}`
    );
    return logs.reduce((sum, l) => sum + l.amount, 0);
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
      const d = new Date(today); d.setDate(d.getDate() - i);
      const s = await this.getDailyStats(userId, d);
      if (s.calories > 0) streak++;
      else break;
    }
    return streak;
  }

  async logWeight(userId: number, weight: number): Promise<WeightLog> {
    const [log] = await db.insert(weightLogs).values({ userId, weight }).returning();
    return log;
  }

  async getWeightLogs(userId: number, limit = 10): Promise<WeightLog[]> {
    return db.select().from(weightLogs)
      .where(eq(weightLogs.userId, userId))
      .orderBy(desc(weightLogs.date))
      .limit(limit);
  }

  async getWeightLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<WeightLog[]> {
    return db.select().from(weightLogs).where(
      sql`${weightLogs.userId} = ${userId} AND ${weightLogs.date} >= ${startDate} AND ${weightLogs.date} <= ${endDate}`
    ).orderBy(weightLogs.date);
  }

  async createWorkoutLog(log: InsertWorkoutLog): Promise<WorkoutLog> {
    const [entry] = await db.insert(workoutLogs).values(log).returning();
    return entry;
  }

  async getDailyWorkouts(userId: number, date: Date): Promise<WorkoutLog[]> {
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end = new Date(date); end.setHours(23, 59, 59, 999);
    return db.select().from(workoutLogs).where(
      sql`${workoutLogs.userId} = ${userId} AND ${workoutLogs.date} >= ${start} AND ${workoutLogs.date} <= ${end}`
    ).orderBy(desc(workoutLogs.date));
  }

  async getWorkoutLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<WorkoutLog[]> {
    return db.select().from(workoutLogs).where(
      sql`${workoutLogs.userId} = ${userId} AND ${workoutLogs.date} >= ${startDate} AND ${workoutLogs.date} <= ${endDate}`
    ).orderBy(workoutLogs.date);
  }

  async getWorkoutLogs(userId: number, limit = 10): Promise<WorkoutLog[]> {
    return db.select().from(workoutLogs)
      .where(eq(workoutLogs.userId, userId))
      .orderBy(desc(workoutLogs.date))
      .limit(limit);
  }

  async deleteWorkoutLog(id: number): Promise<void> {
    await db.delete(workoutLogs).where(eq(workoutLogs.id, id));
  }

  async deleteWorkoutLogsBySource(userId: number, date: Date, source: string): Promise<void> {
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end = new Date(date); end.setHours(23, 59, 59, 999);
    await db.delete(workoutLogs).where(
      sql`${workoutLogs.userId} = ${userId} AND ${workoutLogs.source} = ${source} AND ${workoutLogs.date} >= ${start} AND ${workoutLogs.date} <= ${end}`
    );
  }

  async getUserByHealthSyncToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.healthSyncToken, token));
    return user;
  }

  async setHealthSyncToken(userId: number, token: string): Promise<void> {
    await db.update(users).set({ healthSyncToken: token }).where(eq(users.id, userId));
  }

}

export const storage = new DatabaseStorage();
