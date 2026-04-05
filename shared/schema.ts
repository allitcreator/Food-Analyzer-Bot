import { pgTable, text, serial, integer, boolean, timestamp, real } from "drizzle-orm/pg-core";
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
  timezone: text("timezone").default("Europe/Moscow"),          // IANA timezone
  mealBreakfastEnd: text("meal_breakfast_end").default("12:30"), // завтрак до HH:MM
  mealLunchEnd: text("meal_lunch_end").default("16:30"),       // обед до HH:MM
  healthSyncToken: text("health_sync_token").unique(), // token for Apple Health HTTP webhook
  createdAt: timestamp("created_at").defaultNow(),
});

export const foodLogs = pgTable("food_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
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
});

export const waterLogs = pgTable("water_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  amount: integer("amount").notNull(), // in ml
  date: timestamp("date").defaultNow(),
});

export const weightLogs = pgTable("weight_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  weight: real("weight").notNull(), // in kg, e.g. 85.3
  date: timestamp("date").defaultNow(),
});

export const workoutLogs = pgTable("workout_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  description: text("description").notNull(),   // "бег 30 мин", "эллипс 45 мин"
  workoutType: text("workout_type").notNull(),   // "бег", "эллипс", "силовая", "шаги" etc.
  durationMin: integer("duration_min"),          // null if only steps/kcal given
  caloriesBurned: integer("calories_burned").notNull(),
  source: text("source").default("manual"),     // "manual" | "apple_health"
  date: timestamp("date").defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  logs: many(foodLogs),
  waterLogs: many(waterLogs),
  weightLogs: many(weightLogs),
  workoutLogs: many(workoutLogs),
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

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertFoodLogSchema = createInsertSchema(foodLogs).omit({ id: true, date: true });
export const insertWaterLogSchema = createInsertSchema(waterLogs).omit({ id: true, date: true });
export const insertWeightLogSchema = createInsertSchema(weightLogs).omit({ id: true, date: true });
export const insertWorkoutLogSchema = createInsertSchema(workoutLogs).omit({ id: true, date: true });

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

export type CreateFoodLogRequest = InsertFoodLog;
export type StatsResponse = {
  dailyCalories: number;
  dailyProtein: number;
  dailyFat: number;
  dailyCarbs: number;
  weeklyCalories: number[];
};
