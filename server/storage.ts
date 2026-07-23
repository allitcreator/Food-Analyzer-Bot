import { users, foodLogs, waterLogs, weightLogs, workoutLogs, type User, type InsertUser, type FoodLog, type InsertFoodLog, type WaterLog, type WeightLog, type WorkoutLog, type InsertWorkoutLog } from "@shared/schema";
import { db } from "./db";
import { eq, and, sql, desc, gte, lte, lt } from "drizzle-orm";
import { calcGoalsFromProfile } from "./lib/goals";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByTelegramId(telegramId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, data: Partial<User>): Promise<User>;
  deleteUser(id: number): Promise<void>;
  getAllUsers(): Promise<User[]>;
  getAllApprovedUsers(): Promise<User[]>;

  createFoodLog(log: InsertFoodLog): Promise<FoodLog>;
  getFoodLogs(userId: number, opts?: { limit?: number; offset?: number }): Promise<FoodLog[]>;
  getFoodLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<FoodLog[]>;
  deleteFoodLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<void>;
  deleteFoodLog(id: number, userId: number): Promise<void>;
  updateFoodLog(id: number, userId: number, data: Partial<InsertFoodLog>): Promise<FoodLog>;
  getFoodLogById(id: number, userId: number): Promise<FoodLog | undefined>;

  getDailyStats(userId: number, date: Date): Promise<{ calories: number; protein: number; fat: number; carbs: number; fiber: number; sugar: number; sodium: number; saturatedFat: number }>;
  getWeeklyStats(userId: number, tz?: string): Promise<{ date: string; calories: number }[]>;
  getWeeklyFullStats(userId: number, tz?: string): Promise<{ date: string; dayLabel: string; calories: number; protein: number; fat: number; carbs: number }[]>;
  getMonthlyStats(userId: number, tz?: string): Promise<{ weekLabel: string; calories: number; protein: number; fat: number; carbs: number; days: number }[]>;
  getStreak(userId: number, tz?: string): Promise<number>;

  calculateAndSetGoals(userId: number): Promise<User>;
  updateUserReportTime(userId: number, time: string): Promise<void>;
  updateUserReminder(userId: number, meal: 'breakfast' | 'lunch' | 'dinner', time: string): Promise<void>;

  logWater(userId: number, amount: number): Promise<void>;
  getDailyWater(userId: number, date: Date): Promise<number>;
  getWaterLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<WaterLog[]>;
  getDailyWaterLogs(userId: number, date: Date): Promise<WaterLog[]>;
  updateWaterLog(id: number, userId: number, amount: number): Promise<WaterLog>;
  deleteWaterLog(id: number, userId: number): Promise<void>;

  logWeight(userId: number, weight: number): Promise<WeightLog>;
  getWeightLogs(userId: number, limit?: number): Promise<WeightLog[]>;
  getWeightLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<WeightLog[]>;
  updateWeightLog(id: number, userId: number, weight: number): Promise<WeightLog>;
  deleteWeightLog(id: number, userId: number): Promise<void>;

  createWorkoutLog(log: InsertWorkoutLog): Promise<WorkoutLog>;
  getDailyWorkouts(userId: number, date: Date): Promise<WorkoutLog[]>;
  getWorkoutLogs(userId: number, limit?: number): Promise<WorkoutLog[]>;
  getWorkoutLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<WorkoutLog[]>;
  getWorkoutLogById(id: number, userId: number): Promise<WorkoutLog | undefined>;
  updateWorkoutLog(id: number, userId: number, data: Partial<InsertWorkoutLog>): Promise<WorkoutLog>;
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

    const { calories, protein, fat, carbs } = calcGoalsFromProfile({
      weight: user.weight,
      height: user.height,
      age: user.age,
      gender: user.gender,
      activityLevel: user.activityLevel,
      goal: user.goal,
    });

    return this.updateUser(userId, { caloriesGoal: calories, proteinGoal: protein, fatGoal: fat, carbsGoal: carbs });
  }

  async deleteUser(id: number): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(foodLogs).where(eq(foodLogs.userId, id));
      await tx.delete(waterLogs).where(eq(waterLogs.userId, id));
      await tx.delete(weightLogs).where(eq(weightLogs.userId, id));
      await tx.delete(workoutLogs).where(eq(workoutLogs.userId, id));
      await tx.delete(users).where(eq(users.id, id));
    });
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

  async getFoodLogs(userId: number, opts?: { limit?: number; offset?: number }): Promise<FoodLog[]> {
    let q = db.select().from(foodLogs).where(eq(foodLogs.userId, userId)).orderBy(desc(foodLogs.date)).$dynamic();
    if (opts?.limit !== undefined) q = q.limit(opts.limit);
    if (opts?.offset !== undefined) q = q.offset(opts.offset);
    return q;
  }

  async getDailyStats(userId: number, date: Date) {
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end = new Date(date); end.setHours(23, 59, 59, 999);

    const [row] = await db.select({
      calories: sql<number>`COALESCE(SUM(${foodLogs.calories}), 0)`,
      protein: sql<number>`COALESCE(SUM(${foodLogs.protein}), 0)`,
      fat: sql<number>`COALESCE(SUM(${foodLogs.fat}), 0)`,
      carbs: sql<number>`COALESCE(SUM(${foodLogs.carbs}), 0)`,
      fiber: sql<number>`COALESCE(SUM(${foodLogs.fiber}), 0)`,
      sugar: sql<number>`COALESCE(SUM(${foodLogs.sugar}), 0)`,
      sodium: sql<number>`COALESCE(SUM(${foodLogs.sodium}), 0)`,
      saturatedFat: sql<number>`COALESCE(SUM(${foodLogs.saturatedFat}), 0)`,
    }).from(foodLogs).where(
      and(eq(foodLogs.userId, userId), gte(foodLogs.date, start), lte(foodLogs.date, end))
    );

    return {
      calories: Number(row?.calories ?? 0),
      protein: Number(row?.protein ?? 0),
      fat: Number(row?.fat ?? 0),
      carbs: Number(row?.carbs ?? 0),
      fiber: Number(row?.fiber ?? 0),
      sugar: Number(row?.sugar ?? 0),
      sodium: Number(row?.sodium ?? 0),
      saturatedFat: Number(row?.saturatedFat ?? 0),
    };
  }

  private getNow(tz?: string): Date {
    if (!tz) return new Date();
    // Convert "now" into the given IANA timezone reliably via formatToParts,
    // then rebuild a local Date whose wall-clock fields match that timezone.
    // (Same result as the old `toLocaleString` hack, but locale-independent.)
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
      hour12: false,
    }).formatToParts(new Date());
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    let hour = get('hour');
    if (hour === 24) hour = 0; // some engines emit 24 for midnight with hour12:false
    return new Date(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  }

  // One query for a set of day-buckets: fetch food macros over the whole span,
  // then bucket in JS by the exact same per-day [00:00.000, 23:59:59.999] bounds.
  // Avoids N+1 while preserving the day-boundary semantics of getDailyStats.
  private async getFoodMacrosByDay(
    userId: number,
    days: Date[],
  ): Promise<{ calories: number; protein: number; fat: number; carbs: number }[]> {
    const buckets = days.map((d) => {
      const start = new Date(d); start.setHours(0, 0, 0, 0);
      const end = new Date(d); end.setHours(23, 59, 59, 999);
      return { start, end };
    });
    const min = new Date(Math.min(...buckets.map((b) => b.start.getTime())));
    const max = new Date(Math.max(...buckets.map((b) => b.end.getTime())));

    const rows = await db.select({
      date: foodLogs.date,
      calories: foodLogs.calories,
      protein: foodLogs.protein,
      fat: foodLogs.fat,
      carbs: foodLogs.carbs,
    }).from(foodLogs).where(
      and(eq(foodLogs.userId, userId), gte(foodLogs.date, min), lte(foodLogs.date, max))
    );

    return buckets.map((b) => {
      let calories = 0, protein = 0, fat = 0, carbs = 0;
      for (const r of rows) {
        if (r.date && r.date >= b.start && r.date <= b.end) {
          calories += r.calories; protein += r.protein; fat += r.fat; carbs += r.carbs;
        }
      }
      return { calories, protein, fat, carbs };
    });
  }

  async getWeeklyStats(userId: number, tz?: string) {
    const days: Date[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = this.getNow(tz); date.setDate(date.getDate() - i);
      days.push(date);
    }
    const macros = await this.getFoodMacrosByDay(userId, days);
    return days.map((date, idx) => ({
      date: date.toISOString().split('T')[0],
      calories: macros[idx].calories,
    }));
  }

  async getWeeklyFullStats(userId: number, tz?: string) {
    const DAY_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const days: Date[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = this.getNow(tz); d.setDate(d.getDate() - i);
      days.push(d);
    }
    const macros = await this.getFoodMacrosByDay(userId, days);
    return days.map((d, idx) => {
      const s = macros[idx];
      const dd = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
      return {
        date: d.toISOString().split('T')[0],
        dayLabel: `${DAY_RU[d.getDay()]} ${dd}`,
        calories: s.calories, protein: s.protein, fat: s.fat, carbs: s.carbs,
      };
    });
  }

  async getMonthlyStats(userId: number, tz?: string) {
    const today = this.getNow(tz);

    const weekDefs: { weekLabel: string; days: Date[] }[] = [];
    const allDays: Date[] = [];

    for (let w = 3; w >= 0; w--) {
      const weekEnd = new Date(today);
      weekEnd.setDate(today.getDate() - w * 7);
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekEnd.getDate() - 6);

      const days: Date[] = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(weekStart);
        day.setDate(weekStart.getDate() + d);
        if (day > today) break;
        days.push(day);
      }

      const startLabel = `${String(weekStart.getDate()).padStart(2, '0')}.${String(weekStart.getMonth() + 1).padStart(2, '0')}`;
      const endLabel = `${String(weekEnd.getDate()).padStart(2, '0')}.${String(weekEnd.getMonth() + 1).padStart(2, '0')}`;
      weekDefs.push({ weekLabel: `${startLabel}–${endLabel}`, days });
      allDays.push(...days);
    }

    const macros = allDays.length ? await this.getFoodMacrosByDay(userId, allDays) : [];

    const weeks: { weekLabel: string; calories: number; protein: number; fat: number; carbs: number; days: number }[] = [];
    let idx = 0;
    for (const wd of weekDefs) {
      let totalCal = 0, totalProt = 0, totalFat = 0, totalCarbs = 0, activeDays = 0;
      for (let k = 0; k < wd.days.length; k++) {
        const s = macros[idx++];
        if (s.calories > 0) {
          totalCal += s.calories; totalProt += s.protein;
          totalFat += s.fat; totalCarbs += s.carbs;
          activeDays++;
        }
      }
      weeks.push({
        weekLabel: wd.weekLabel,
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

  async deleteFoodLog(id: number, userId: number): Promise<void> {
    await db.delete(foodLogs).where(and(eq(foodLogs.id, id), eq(foodLogs.userId, userId)));
  }

  async updateFoodLog(id: number, userId: number, data: Partial<InsertFoodLog>): Promise<FoodLog> {
    const [updated] = await db.update(foodLogs).set(data).where(and(eq(foodLogs.id, id), eq(foodLogs.userId, userId))).returning();
    return updated;
  }

  async getFoodLogById(id: number, userId: number): Promise<FoodLog | undefined> {
    const [log] = await db.select().from(foodLogs).where(and(eq(foodLogs.id, id), eq(foodLogs.userId, userId)));
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

  async getWaterLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<WaterLog[]> {
    return db.select().from(waterLogs).where(
      sql`${waterLogs.userId} = ${userId} AND ${waterLogs.date} >= ${startDate} AND ${waterLogs.date} <= ${endDate}`
    ).orderBy(waterLogs.date);
  }

  async getDailyWaterLogs(userId: number, date: Date): Promise<WaterLog[]> {
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end = new Date(date); end.setHours(23, 59, 59, 999);
    return db.select().from(waterLogs).where(
      sql`${waterLogs.userId} = ${userId} AND ${waterLogs.date} >= ${start} AND ${waterLogs.date} <= ${end}`
    ).orderBy(desc(waterLogs.date));
  }

  async updateWaterLog(id: number, userId: number, amount: number): Promise<WaterLog> {
    const [updated] = await db.update(waterLogs).set({ amount })
      .where(and(eq(waterLogs.id, id), eq(waterLogs.userId, userId))).returning();
    return updated;
  }

  async deleteWaterLog(id: number, userId: number): Promise<void> {
    await db.delete(waterLogs).where(and(eq(waterLogs.id, id), eq(waterLogs.userId, userId)));
  }

  async updateUserReportTime(userId: number, time: string): Promise<void> {
    await db.update(users).set({ reportTime: time }).where(eq(users.id, userId));
  }

  async updateUserReminder(userId: number, meal: 'breakfast' | 'lunch' | 'dinner', time: string): Promise<void> {
    const field = meal === 'breakfast' ? 'breakfastReminder' : meal === 'lunch' ? 'lunchReminder' : 'dinnerReminder';
    await db.update(users).set({ [field]: time }).where(eq(users.id, userId));
  }

  async getStreak(userId: number, tz?: string): Promise<number> {
    const today = this.getNow(tz);
    // Daily calorie sums for the last 366 days in a single query; index = day offset.
    const days: Date[] = [];
    for (let i = 0; i < 366; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      days.push(d);
    }
    const macros = await this.getFoodMacrosByDay(userId, days);
    const calories = macros.map((m) => m.calories);

    const startOffset = calories[0] > 0 ? 0 : 1;
    let streak = 0;
    for (let i = startOffset; i < 365; i++) {
      if ((calories[i] ?? 0) > 0) streak++;
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

  async updateWeightLog(id: number, userId: number, weight: number): Promise<WeightLog> {
    const [updated] = await db.update(weightLogs).set({ weight })
      .where(and(eq(weightLogs.id, id), eq(weightLogs.userId, userId))).returning();
    return updated;
  }

  async deleteWeightLog(id: number, userId: number): Promise<void> {
    await db.delete(weightLogs).where(and(eq(weightLogs.id, id), eq(weightLogs.userId, userId)));
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

  async getWorkoutLogById(id: number, userId: number): Promise<WorkoutLog | undefined> {
    const [log] = await db.select().from(workoutLogs)
      .where(and(eq(workoutLogs.id, id), eq(workoutLogs.userId, userId)));
    return log;
  }

  async updateWorkoutLog(id: number, userId: number, data: Partial<InsertWorkoutLog>): Promise<WorkoutLog> {
    const [updated] = await db.update(workoutLogs).set(data)
      .where(and(eq(workoutLogs.id, id), eq(workoutLogs.userId, userId))).returning();
    return updated;
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
