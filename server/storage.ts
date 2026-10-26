import { users, foodLogs, waterLogs, weightLogs, workoutLogs, barcodeProducts, favorites, botState, notificationSends, type User, type InsertUser, type FoodLog, type InsertFoodLog, type WaterLog, type WeightLog, type WorkoutLog, type InsertWorkoutLog, type BarcodeProduct, type InsertBarcodeProduct, type Favorite, type VisibleFavorite, type FavoriteItem } from "@shared/schema";
import { db } from "./db";
import { eq, and, or, sql, desc, gte, lte, lt, isNull } from "drizzle-orm";
import { calcGoalsFromProfile } from "./lib/goals";
import { dayBoundsUtc, todayKey, addDaysKey, rangeBoundsUtc } from "./lib/tz";
import { lastNDayKeys, dayLabelRu, monthlyWeekDefs, bucketByDayKey } from "./lib/stats-days";

/** IANA-зона пользователя; пустая/неизвестная → Europe/Moscow (lib/tz). */
type Tz = string | null | undefined;

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByTelegramId(telegramId: string): Promise<User | undefined>;
  getUserByQuickToken(token: string): Promise<User | undefined>;
  setQuickToken(userId: number, token: string | null): Promise<void>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, data: Partial<User>): Promise<User>;
  deleteUser(id: number): Promise<void>;
  getAllUsers(): Promise<User[]>;
  /** Одобренные и не заблокированные — получатели планировщика уведомлений. */
  getAllApprovedUsers(): Promise<User[]>;

  createFoodLog(log: InsertFoodLog): Promise<FoodLog>;
  getFoodLogs(userId: number, opts?: { limit?: number; offset?: number }): Promise<FoodLog[]>;
  getFoodLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<FoodLog[]>;
  deleteFoodLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<void>;
  deleteFoodLog(id: number, userId: number): Promise<void>;
  updateFoodLog(id: number, userId: number, data: Partial<InsertFoodLog>): Promise<FoodLog>;
  getFoodLogById(id: number, userId: number): Promise<FoodLog | undefined>;

  /** Дневные методы: `dayKey` — "YYYY-MM-DD", границы суток — в зоне `tz`. */
  getDailyStats(userId: number, dayKey: string, tz: Tz): Promise<{ calories: number; protein: number; fat: number; carbs: number; fiber: number; sugar: number; sodium: number; saturatedFat: number }>;
  getWeeklyStats(userId: number, tz: Tz): Promise<{ date: string; calories: number }[]>;
  getWeeklyFullStats(userId: number, tz: Tz): Promise<{ date: string; dayLabel: string; calories: number; protein: number; fat: number; carbs: number }[]>;
  getMonthlyStats(userId: number, tz: Tz): Promise<{ weekLabel: string; calories: number; protein: number; fat: number; carbs: number; days: number }[]>;
  getStreak(userId: number, tz: Tz): Promise<number>;

  calculateAndSetGoals(userId: number): Promise<User>;
  updateUserReportTime(userId: number, time: string): Promise<void>;
  updateUserReminder(userId: number, meal: 'breakfast' | 'lunch' | 'dinner', time: string): Promise<void>;

  logWater(userId: number, amount: number): Promise<void>;
  getDailyWater(userId: number, dayKey: string, tz: Tz): Promise<number>;
  getWaterLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<WaterLog[]>;
  getDailyWaterLogs(userId: number, dayKey: string, tz: Tz): Promise<WaterLog[]>;
  updateWaterLog(id: number, userId: number, amount: number): Promise<WaterLog>;
  deleteWaterLog(id: number, userId: number): Promise<void>;

  logWeight(userId: number, weight: number): Promise<WeightLog>;
  getWeightLogs(userId: number, limit?: number): Promise<WeightLog[]>;
  getWeightLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<WeightLog[]>;
  updateWeightLog(id: number, userId: number, weight: number): Promise<WeightLog>;
  deleteWeightLog(id: number, userId: number): Promise<void>;

  createWorkoutLog(log: InsertWorkoutLog): Promise<WorkoutLog>;
  getDailyWorkouts(userId: number, dayKey: string, tz: Tz): Promise<WorkoutLog[]>;
  getWorkoutLogs(userId: number, limit?: number): Promise<WorkoutLog[]>;
  getWorkoutLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<WorkoutLog[]>;
  getWorkoutLogById(id: number, userId: number): Promise<WorkoutLog | undefined>;
  updateWorkoutLog(id: number, userId: number, data: Partial<InsertWorkoutLog>): Promise<WorkoutLog>;
  deleteWorkoutLog(id: number): Promise<void>;
  deleteWorkoutLogsBySource(userId: number, dayKey: string, tz: Tz, source: string): Promise<void>;

  getBarcodeProduct(barcode: string): Promise<BarcodeProduct | undefined>;
  upsertBarcodeProduct(product: InsertBarcodeProduct): Promise<BarcodeProduct>;
  /**
   * Запись из vision: вставляет новую или обновляет только такую же vision-запись.
   * Данные Open Food Facts (source != 'vision') не трогает. false — не записано.
   */
  upsertVisionBarcodeProduct(product: InsertBarcodeProduct): Promise<boolean>;

  getFavorites(userId: number): Promise<Favorite[]>;
  getVisibleFavorites(userId: number): Promise<VisibleFavorite[]>;
  getVisibleFavoriteById(userId: number, id: number): Promise<VisibleFavorite | undefined>;
  createFavorite(fav: { userId: number; title: string; items: FavoriteItem[] }): Promise<Favorite>;
  setFavoriteShared(userId: number, id: number, isShared: boolean): Promise<Favorite | undefined>;
  deleteFavorite(userId: number, id: number): Promise<void>;
  countRecentFoodName(userId: number, foodName: string, days: number): Promise<number>;

  // Умные напоминания: время+тип записей еды за N дней (лёгкая выборка) и самое
  // частое блюдо конкретного приёма за N дней.
  getMealLogTimes(userId: number, days: number): Promise<{ date: Date; mealType: string }[]>;
  getTopMealFood(userId: number, mealType: string, days: number): Promise<FoodLog | null>;

  // Persistent bot session state (survives deploy/restart).
  loadAllBotState(): Promise<{ telegramId: string; key: string; value: unknown }[]>;
  upsertBotState(telegramId: string, key: string, value: unknown): Promise<void>;
  deleteBotState(telegramId: string, key: string): Promise<void>;
  cleanupBotState(olderThanDays: number): Promise<void>;

  // At-most-once ledger for scheduled notifications.
  claimNotificationSend(userId: number, kind: string, dayKey: string): Promise<boolean>;
  cleanupNotificationSends(olderThanDays: number): Promise<void>;
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

  // Быстрая запись с телефона: поиск по Bearer-токену шортката. Пустую строку
  // не ищем — иначе запрос без токена совпал бы с любым пользователем, у
  // которого колонка пуста (в БД там NULL, но подстраховаться дешевле).
  async getUserByQuickToken(token: string): Promise<User | undefined> {
    if (!token) return undefined;
    const [user] = await db.select().from(users).where(eq(users.quickToken, token));
    return user;
  }

  async setQuickToken(userId: number, token: string | null): Promise<void> {
    await db.update(users).set({ quickToken: token }).where(eq(users.id, userId));
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
    // Получатели отчётов и напоминаний: одобренные и не заблокированные
    // (is_blocked nullable — NULL считаем «не заблокирован»).
    return db.select().from(users).where(and(
      eq(users.isApproved, true),
      or(isNull(users.isBlocked), eq(users.isBlocked, false)),
    ));
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

  async getDailyStats(userId: number, dayKey: string, tz: Tz) {
    const { start, end } = dayBoundsUtc(dayKey, tz);

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

  // One query for a set of calendar days (in the user's tz): fetch food macros
  // over the whole span, then bucket in JS by the record's day in that tz.
  // Avoids N+1 while keeping the day-boundary semantics of getDailyStats.
  private async getFoodMacrosByDay(
    userId: number,
    dayKeys: string[],
    tz: Tz,
  ): Promise<{ calories: number; protein: number; fat: number; carbs: number }[]> {
    if (dayKeys.length === 0) return [];
    const sorted = [...dayKeys].sort();
    const { start: min, end: max } = rangeBoundsUtc(sorted[0], sorted[sorted.length - 1], tz);

    const rows = await db.select({
      date: foodLogs.date,
      calories: foodLogs.calories,
      protein: foodLogs.protein,
      fat: foodLogs.fat,
      carbs: foodLogs.carbs,
    }).from(foodLogs).where(
      and(eq(foodLogs.userId, userId), gte(foodLogs.date, min), lte(foodLogs.date, max))
    );

    const buckets = bucketByDayKey(rows, dayKeys, tz);
    return dayKeys.map((key) => {
      let calories = 0, protein = 0, fat = 0, carbs = 0;
      for (const r of buckets.get(key) ?? []) {
        calories += r.calories; protein += r.protein; fat += r.fat; carbs += r.carbs;
      }
      return { calories, protein, fat, carbs };
    });
  }

  async getWeeklyStats(userId: number, tz: Tz) {
    const days = lastNDayKeys(new Date(), tz, 7);
    const macros = await this.getFoodMacrosByDay(userId, days, tz);
    return days.map((date, idx) => ({ date, calories: macros[idx].calories }));
  }

  async getWeeklyFullStats(userId: number, tz: Tz) {
    const days = lastNDayKeys(new Date(), tz, 7);
    const macros = await this.getFoodMacrosByDay(userId, days, tz);
    return days.map((date, idx) => {
      const s = macros[idx];
      return {
        date,
        dayLabel: dayLabelRu(date),
        calories: s.calories, protein: s.protein, fat: s.fat, carbs: s.carbs,
      };
    });
  }

  async getMonthlyStats(userId: number, tz: Tz) {
    const weekDefs = monthlyWeekDefs(new Date(), tz);
    const allDays = weekDefs.flatMap((wd) => wd.dayKeys);
    const macros = await this.getFoodMacrosByDay(userId, allDays, tz);

    const weeks: { weekLabel: string; calories: number; protein: number; fat: number; carbs: number; days: number }[] = [];
    let idx = 0;
    for (const wd of weekDefs) {
      let totalCal = 0, totalProt = 0, totalFat = 0, totalCarbs = 0, activeDays = 0;
      for (let k = 0; k < wd.dayKeys.length; k++) {
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
      and(eq(foodLogs.userId, userId), gte(foodLogs.date, startDate), lte(foodLogs.date, endDate))
    ).orderBy(foodLogs.date);
  }

  async deleteFoodLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<void> {
    await db.delete(foodLogs).where(
      and(eq(foodLogs.userId, userId), gte(foodLogs.date, startDate), lte(foodLogs.date, endDate))
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

  async getDailyWater(userId: number, dayKey: string, tz: Tz): Promise<number> {
    const { start, end } = dayBoundsUtc(dayKey, tz);
    const logs = await db.select().from(waterLogs).where(
      and(eq(waterLogs.userId, userId), gte(waterLogs.date, start), lte(waterLogs.date, end))
    );
    return logs.reduce((sum, l) => sum + l.amount, 0);
  }

  async getWaterLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<WaterLog[]> {
    return db.select().from(waterLogs).where(
      and(eq(waterLogs.userId, userId), gte(waterLogs.date, startDate), lte(waterLogs.date, endDate))
    ).orderBy(waterLogs.date);
  }

  async getDailyWaterLogs(userId: number, dayKey: string, tz: Tz): Promise<WaterLog[]> {
    const { start, end } = dayBoundsUtc(dayKey, tz);
    return db.select().from(waterLogs).where(
      and(eq(waterLogs.userId, userId), gte(waterLogs.date, start), lte(waterLogs.date, end))
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

  async getStreak(userId: number, tz: Tz): Promise<number> {
    const today = todayKey(new Date(), tz);
    // Daily calorie sums for the last 366 days in a single query; index = day offset.
    const days: string[] = [];
    for (let i = 0; i < 366; i++) days.push(addDaysKey(today, -i));
    const macros = await this.getFoodMacrosByDay(userId, days, tz);
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
      and(eq(weightLogs.userId, userId), gte(weightLogs.date, startDate), lte(weightLogs.date, endDate))
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

  async getDailyWorkouts(userId: number, dayKey: string, tz: Tz): Promise<WorkoutLog[]> {
    const { start, end } = dayBoundsUtc(dayKey, tz);
    return db.select().from(workoutLogs).where(
      and(eq(workoutLogs.userId, userId), gte(workoutLogs.date, start), lte(workoutLogs.date, end))
    ).orderBy(desc(workoutLogs.date));
  }

  async getWorkoutLogsInRange(userId: number, startDate: Date, endDate: Date): Promise<WorkoutLog[]> {
    return db.select().from(workoutLogs).where(
      and(eq(workoutLogs.userId, userId), gte(workoutLogs.date, startDate), lte(workoutLogs.date, endDate))
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

  async deleteWorkoutLogsBySource(userId: number, dayKey: string, tz: Tz, source: string): Promise<void> {
    const { start, end } = dayBoundsUtc(dayKey, tz);
    await db.delete(workoutLogs).where(
      and(eq(workoutLogs.userId, userId), eq(workoutLogs.source, source), gte(workoutLogs.date, start), lte(workoutLogs.date, end))
    );
  }

  async getBarcodeProduct(barcode: string): Promise<BarcodeProduct | undefined> {
    const [row] = await db.select().from(barcodeProducts).where(eq(barcodeProducts.barcode, barcode));
    return row;
  }

  async upsertBarcodeProduct(product: InsertBarcodeProduct): Promise<BarcodeProduct> {
    const { barcode, ...rest } = product;
    const [row] = await db.insert(barcodeProducts)
      .values(product)
      .onConflictDoUpdate({ target: barcodeProducts.barcode, set: rest })
      .returning();
    return row;
  }

  async upsertVisionBarcodeProduct(product: InsertBarcodeProduct): Promise<boolean> {
    const { barcode, ...rest } = product;
    // Условие в самом upsert, а не чтение перед записью: так OFF-запись не
    // затрётся, даже если она появилась между двумя запросами.
    const rows = await db.insert(barcodeProducts)
      .values({ ...product, source: "vision" })
      .onConflictDoUpdate({
        target: barcodeProducts.barcode,
        set: { ...rest, source: "vision" },
        setWhere: eq(barcodeProducts.source, "vision"),
      })
      .returning({ barcode: barcodeProducts.barcode });
    return rows.length > 0;
  }

  async getFavorites(userId: number): Promise<Favorite[]> {
    return db.select().from(favorites)
      .where(eq(favorites.userId, userId))
      .orderBy(desc(favorites.createdAt));
  }

  // Everything a user may see & log: all of their own favorites plus every
  // favorite shared by anyone. Each row is annotated with ownership and the
  // author's @username (null when the author has no username).
  async getVisibleFavorites(userId: number): Promise<VisibleFavorite[]> {
    const rows = await db
      .select({
        id: favorites.id,
        userId: favorites.userId,
        title: favorites.title,
        items: favorites.items,
        isShared: favorites.isShared,
        createdAt: favorites.createdAt,
        ownerName: users.username,
      })
      .from(favorites)
      .innerJoin(users, eq(favorites.userId, users.id))
      .where(or(eq(favorites.userId, userId), eq(favorites.isShared, true)))
      .orderBy(desc(favorites.createdAt));
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      title: r.title,
      items: r.items,
      isShared: r.isShared,
      createdAt: r.createdAt,
      isOwner: r.userId === userId,
      ownerName: r.ownerName ?? null,
    }));
  }

  // A single visible favorite by id: own (any) or someone else's shared one.
  async getVisibleFavoriteById(userId: number, id: number): Promise<VisibleFavorite | undefined> {
    const [r] = await db
      .select({
        id: favorites.id,
        userId: favorites.userId,
        title: favorites.title,
        items: favorites.items,
        isShared: favorites.isShared,
        createdAt: favorites.createdAt,
        ownerName: users.username,
      })
      .from(favorites)
      .innerJoin(users, eq(favorites.userId, users.id))
      .where(and(eq(favorites.id, id), or(eq(favorites.userId, userId), eq(favorites.isShared, true))));
    if (!r) return undefined;
    return {
      id: r.id,
      userId: r.userId,
      title: r.title,
      items: r.items,
      isShared: r.isShared,
      createdAt: r.createdAt,
      isOwner: r.userId === userId,
      ownerName: r.ownerName ?? null,
    };
  }

  async createFavorite(fav: { userId: number; title: string; items: FavoriteItem[] }): Promise<Favorite> {
    const [row] = await db.insert(favorites).values(fav).returning();
    return row;
  }

  // Toggle sharing — ownership baked into the WHERE, so only the owner can
  // change it. Returns undefined when the row isn't the caller's (404/403).
  async setFavoriteShared(userId: number, id: number, isShared: boolean): Promise<Favorite | undefined> {
    const [row] = await db.update(favorites).set({ isShared })
      .where(and(eq(favorites.id, id), eq(favorites.userId, userId))).returning();
    return row;
  }

  async deleteFavorite(userId: number, id: number): Promise<void> {
    // Ownership check baked into the WHERE — a user can only delete their own.
    await db.delete(favorites).where(and(eq(favorites.id, id), eq(favorites.userId, userId)));
  }

  // How many times a dish with this exact name (case-insensitive) was logged
  // in the last `days` days — drives the "add to favorites?" suggestion.
  async countRecentFoodName(userId: number, foodName: string, days: number): Promise<number> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const [row] = await db.select({ count: sql<number>`COUNT(*)` }).from(foodLogs).where(
      and(
        eq(foodLogs.userId, userId),
        gte(foodLogs.date, since),
        sql`LOWER(${foodLogs.foodName}) = LOWER(${foodName})`,
      )
    );
    return Number(row?.count ?? 0);
  }

  // ── Умные напоминания ───────────────────────────────────────────────────
  // Только date+mealType записей еды за последние `days` дней — лёгкая выборка
  // для вывода «обычного времени» приёмов и списка записанных сегодня приёмов.
  async getMealLogTimes(userId: number, days: number): Promise<{ date: Date; mealType: string }[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const rows = await db.select({ date: foodLogs.date, mealType: foodLogs.mealType })
      .from(foodLogs)
      .where(and(eq(foodLogs.userId, userId), gte(foodLogs.date, since)));
    return rows
      .filter((r): r is { date: Date; mealType: string } => r.date != null)
      .map((r) => ({ date: r.date, mealType: r.mealType }));
  }

  // Самое частое блюдо конкретного приёма за N дней (группировка по
  // lower(food_name)); при равенстве числа — более свежее. Возвращает последнюю
  // запись FoodLog этого блюда (её и «повторяем как обычно»), или null.
  async getTopMealFood(userId: number, mealType: string, days: number): Promise<FoodLog | null> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const rows = await db.select().from(foodLogs).where(
      and(eq(foodLogs.userId, userId), eq(foodLogs.mealType, mealType), gte(foodLogs.date, since)),
    );
    if (rows.length === 0) return null;

    const groups = new Map<string, { count: number; latest: FoodLog }>();
    for (const r of rows) {
      const key = r.foodName.toLowerCase();
      const g = groups.get(key);
      if (!g) {
        groups.set(key, { count: 1, latest: r });
      } else {
        g.count++;
        if ((r.date?.getTime() ?? 0) > (g.latest.date?.getTime() ?? 0)) g.latest = r;
      }
    }

    let best: { count: number; latest: FoodLog } | null = null;
    for (const g of Array.from(groups.values())) {
      if (
        !best ||
        g.count > best.count ||
        (g.count === best.count && (g.latest.date?.getTime() ?? 0) > (best.latest.date?.getTime() ?? 0))
      ) {
        best = g;
      }
    }
    return best ? best.latest : null;
  }

  // ── Persistent bot session state ────────────────────────────────────────
  async loadAllBotState(): Promise<{ telegramId: string; key: string; value: unknown }[]> {
    const rows = await db
      .select({ telegramId: botState.telegramId, key: botState.key, value: botState.value })
      .from(botState);
    return rows.map((r) => ({ telegramId: r.telegramId, key: r.key, value: r.value as unknown }));
  }

  async upsertBotState(telegramId: string, key: string, value: unknown): Promise<void> {
    await db.insert(botState)
      .values({ telegramId, key, value })
      .onConflictDoUpdate({
        target: [botState.telegramId, botState.key],
        set: { value, updatedAt: sql`now()` },
      });
  }

  async deleteBotState(telegramId: string, key: string): Promise<void> {
    await db.delete(botState).where(and(eq(botState.telegramId, telegramId), eq(botState.key, key)));
  }

  async cleanupBotState(olderThanDays: number): Promise<void> {
    await db.delete(botState).where(sql`${botState.updatedAt} < now() - make_interval(days => ${olderThanDays})`);
  }

  // Atomic exclusive claim: INSERT ON CONFLICT DO NOTHING, returning tells us
  // whether the row was actually inserted (true = we own this send).
  async claimNotificationSend(userId: number, kind: string, dayKey: string): Promise<boolean> {
    const rows = await db.insert(notificationSends)
      .values({ userId, kind, dayKey })
      .onConflictDoNothing()
      .returning({ userId: notificationSends.userId });
    return rows.length > 0;
  }

  async cleanupNotificationSends(olderThanDays: number): Promise<void> {
    await db.delete(notificationSends).where(sql`${notificationSends.sentAt} < now() - make_interval(days => ${olderThanDays})`);
  }

}

export const storage = new DatabaseStorage();
