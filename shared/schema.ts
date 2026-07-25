import { pgTable, text, serial, integer, boolean, timestamp, real, index, jsonb, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  telegramId: text("telegram_id").unique(),
  username: text("username"),
  isApproved: boolean("is_approved").default(false),
  isAdmin: boolean("is_admin").default(false),
  isBlocked: boolean("is_blocked").default(false),
  age: integer("age"),
  gender: text("gender"), // male, female
  weight: integer("weight"), // in kg (profile weight)
  height: integer("height"), // in cm
  activityLevel: text("activity_level"), // sedentary, light, moderate, active, very_active
  goal: text("goal"), // lose, maintain, gain
  caloriesGoal: integer("calories_goal"),
  proteinGoal: integer("protein_goal"),
  fatGoal: integer("fat_goal"),
  carbsGoal: integer("carbs_goal"),
  reportTime: text("report_time").default("21:00"),
  breakfastReminder: text("breakfast_reminder").default("off"),
  lunchReminder: text("lunch_reminder").default("off"),
  dinnerReminder: text("dinner_reminder").default("off"),
  noLogReminderTime: text("no_log_reminder_time").default("off"),
  weightReminderTime: text("weight_reminder_time").default("off"),
  weightReminderDays: text("weight_reminder_days").default(""), // "1,3,5" = Mon,Wed,Fri (JS getDay: 0=Sun)
  showMicronutrients: boolean("show_micronutrients").default(false), // toggle micronutrient display
  aiWeekAnalysis: boolean("ai_week_analysis").default(true),     // AI block after /week
  aiMonthAnalysis: boolean("ai_month_analysis").default(true),   // AI block after /month
  aiEveningReport: boolean("ai_evening_report").default(true),   // AI text in evening report
  smartFoodGrouping: boolean("smart_food_grouping").default(true), // AI grouping in Excel top products
  barcodeScanEnabled: boolean("barcode_scan_enabled").default(true), // detect barcodes on photos
  // Умные напоминания о пропущенном приёме: обычное время выводится из истории,
  // пинг только если приём реально не записан к этому времени. Когда включено —
  // заменяет статические breakfast/lunch/dinner-напоминания по расписанию.
  smartReminders: boolean("smart_reminders").notNull().default(false),

  timezone: text("timezone").default("Europe/Moscow"),          // IANA timezone
  mealBreakfastEnd: text("meal_breakfast_end").default("12:30"), // завтрак до HH:MM
  mealLunchEnd: text("meal_lunch_end").default("16:30"),       // обед до HH:MM
  createdAt: timestamp("created_at").defaultNow(),
});

export const foodLogs = pgTable("food_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  foodName: text("food_name").notNull(),
  calories: integer("calories").notNull(),
  protein: integer("protein").notNull(),
  fat: integer("fat").notNull(),
  carbs: integer("carbs").notNull(),
  weight: integer("weight").notNull(), // in grams/ml
  mealType: text("meal_type").notNull(), // breakfast, lunch, dinner, snack
  foodScore: integer("food_score"), // 1-10
  nutritionAdvice: text("nutrition_advice"),
  // Micronutrients (optional, stored always when AI returns them)
  fiber: real("fiber"),         // g
  sugar: real("sugar"),         // g
  sodium: real("sodium"),       // mg
  saturatedFat: real("saturated_fat"), // g
  date: timestamp("date").defaultNow(),
}, (table) => ({
  userDateIdx: index("food_logs_user_id_date_idx").on(table.userId, table.date),
}));

export const waterLogs = pgTable("water_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(), // in ml
  date: timestamp("date").defaultNow(),
}, (table) => ({
  userDateIdx: index("water_logs_user_id_date_idx").on(table.userId, table.date),
}));

export const weightLogs = pgTable("weight_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  weight: real("weight").notNull(), // in kg, e.g. 85.3
  date: timestamp("date").defaultNow(),
}, (table) => ({
  userDateIdx: index("weight_logs_user_id_date_idx").on(table.userId, table.date),
}));

export const workoutLogs = pgTable("workout_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  description: text("description").notNull(),   // "бег 30 мин", "эллипс 45 мин"
  workoutType: text("workout_type").notNull(),   // "бег", "эллипс", "силовая", "шаги" etc.
  durationMin: integer("duration_min"),          // null if only steps/kcal given
  caloriesBurned: integer("calories_burned").notNull(),
  source: text("source").default("manual"),     // источник записи; исторически встречается "apple_health" (интеграция удалена), новые записи — "manual"
  date: timestamp("date").defaultNow(),
}, (table) => ({
  userDateIdx: index("workout_logs_user_id_date_idx").on(table.userId, table.date),
}));

// Global, self-filling cache of packaged products keyed by barcode.
// One product == one row for the whole bot (nutrition is per-product, not
// per-user). Populated from Open Food Facts ("off") or from a confirmed
// vision analysis ("vision"), so a scanned product is looked up only once.
export const barcodeProducts = pgTable("barcode_products", {
  barcode: text("barcode").primaryKey(),
  foodName: text("food_name").notNull(),
  caloriesPer100: real("calories_per_100").notNull(),
  proteinPer100: real("protein_per_100").notNull(),
  fatPer100: real("fat_per_100").notNull(),
  carbsPer100: real("carbs_per_100").notNull(),
  defaultWeight: integer("default_weight").notNull(), // typical serving/volume, g or ml
  hydrating: boolean("hydrating").notNull().default(false),
  source: text("source").notNull(), // "off" | "vision"
  createdAt: timestamp("created_at").defaultNow(),
});

// One saved item inside a favorite. A favorite bundles a whole meal (or a
// single dish), so `items` is an array of these. Hydrating drinks carry
// `hydrating: true` and are replayed into water tracking, not the food diary.
export type FavoriteItem = {
  foodName: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  weight: number;
  hydrating?: boolean;
};

// User-saved favorites: "repeat this meal in one tap".
export const favorites = pgTable("favorites", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  items: jsonb("items").notNull().$type<FavoriteItem[]>(),
  // When true, this favorite is visible to every user (they can log it into
  // their own diary). Sharing is toggled only from the Mini App by the owner.
  isShared: boolean("is_shared").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  userIdx: index("favorites_user_id_idx").on(table.userId),
}));

export const usersRelations = relations(users, ({ many }) => ({
  logs: many(foodLogs),
  waterLogs: many(waterLogs),
  weightLogs: many(weightLogs),
  workoutLogs: many(workoutLogs),
  favorites: many(favorites),
}));

export const favoritesRelations = relations(favorites, ({ one }) => ({
  user: one(users, { fields: [favorites.userId], references: [users.id] }),
}));

export const foodLogsRelations = relations(foodLogs, ({ one }) => ({
  user: one(users, { fields: [foodLogs.userId], references: [users.id] }),
}));

export const waterLogsRelations = relations(waterLogs, ({ one }) => ({
  user: one(users, { fields: [waterLogs.userId], references: [users.id] }),
}));

export const weightLogsRelations = relations(weightLogs, ({ one }) => ({
  user: one(users, { fields: [weightLogs.userId], references: [users.id] }),
}));

export const workoutLogsRelations = relations(workoutLogs, ({ one }) => ({
  user: one(users, { fields: [workoutLogs.userId], references: [users.id] }),
}));

// Persisted snapshot of the bot's in-memory session state so it survives a
// deploy/restart. Keyed by (telegram_id, key): `telegram_id` is the bot's
// chat-id string (the per-record key, e.g. a user's Telegram id), `key` is the
// record name (e.g. "pendingLogs"), `value` is an arbitrary JSON snapshot.
// Intentionally NO FK on users — state may appear before a user is approved or
// even created (the id here is a raw chat id, not users.id).
export const botState = pgTable("bot_state", {
  telegramId: text("telegram_id").notNull(),
  key: text("key").notNull(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.telegramId, table.key] }),
}));

// At-most-once ledger for scheduled sends (evening report, meal / no-log /
// weight reminders). A successful INSERT of (user, kind, day) claims that send;
// a conflict means it already went out. Replaces the old in-memory Set<string>
// dedup so a restart can't double-send or drop a scheduled notification.
export const notificationSends = pgTable("notification_sends", {
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),        // "report" | "meal_breakfast" | "meal_lunch" | "meal_dinner" | "nolog" | "weight"
  dayKey: text("day_key").notNull(),   // user-tz calendar day, e.g. "2026-07-25"
  sentAt: timestamp("sent_at").notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.kind, table.dayKey] }),
}));

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertFoodLogSchema = createInsertSchema(foodLogs).omit({ id: true, date: true });
export const insertWaterLogSchema = createInsertSchema(waterLogs).omit({ id: true, date: true });
export const insertWeightLogSchema = createInsertSchema(weightLogs).omit({ id: true, date: true });
export const insertWorkoutLogSchema = createInsertSchema(workoutLogs).omit({ id: true, date: true });
export const insertBarcodeProductSchema = createInsertSchema(barcodeProducts).omit({ createdAt: true });
export const insertFavoriteSchema = createInsertSchema(favorites).omit({ id: true, createdAt: true });

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type FoodLog = typeof foodLogs.$inferSelect;
export type InsertFoodLog = z.infer<typeof insertFoodLogSchema>;
export type WaterLog = typeof waterLogs.$inferSelect;
export type InsertWaterLog = z.infer<typeof insertWaterLogSchema>;
export type WeightLog = typeof weightLogs.$inferSelect;
export type InsertWeightLog = z.infer<typeof insertWeightLogSchema>;
export type WorkoutLog = typeof workoutLogs.$inferSelect;
export type InsertWorkoutLog = z.infer<typeof insertWorkoutLogSchema>;
export type BarcodeProduct = typeof barcodeProducts.$inferSelect;
export type InsertBarcodeProduct = z.infer<typeof insertBarcodeProductSchema>;
export type Favorite = typeof favorites.$inferSelect;
export type InsertFavorite = z.infer<typeof insertFavoriteSchema>;
export type BotState = typeof botState.$inferSelect;
export type NotificationSend = typeof notificationSends.$inferSelect;

/**
 * A favorite as shown in the "visible" list: the user's own favorites plus
 * everyone's shared ones. `isOwner` distinguishes the two; `ownerName` is the
 * author's @username (null → shown as "от участника" in the UI).
 */
export type VisibleFavorite = Favorite & {
  isOwner: boolean;
  ownerName: string | null;
};

export type CreateFoodLogRequest = InsertFoodLog;
export type StatsResponse = {
  dailyCalories: number;
  dailyProtein: number;
  dailyFat: number;
  dailyCarbs: number;
  weeklyCalories: number[];
};
