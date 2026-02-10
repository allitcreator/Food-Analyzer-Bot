import { pgTable, text, serial, integer, boolean, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  telegramId: text("telegram_id").unique(),
  username: text("username"),
  isApproved: boolean("is_approved").default(false),
  isAdmin: boolean("is_admin").default(false),
  age: integer("age"),
  gender: text("gender"), // male, female
  weight: integer("weight"), // in kg
  height: integer("height"), // in cm
  activityLevel: text("activity_level"), // sedentary, light, moderate, active, very_active
  goal: text("goal"), // lose, maintain, gain
  caloriesGoal: integer("calories_goal"),
  proteinGoal: integer("protein_goal"),
  fatGoal: integer("fat_goal"),
  carbsGoal: integer("carbs_goal"),
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
  weight: integer("weight").notNull(), // in grams
  mealType: text("meal_type").notNull(), // breakfast, lunch, dinner, snack
  date: timestamp("date").defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  logs: many(foodLogs),
}));

export const foodLogsRelations = relations(foodLogs, ({ one }) => ({
  user: one(users, {
    fields: [foodLogs.userId],
    references: [users.id],
  }),
}));

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertFoodLogSchema = createInsertSchema(foodLogs).omit({ id: true, date: true });

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type FoodLog = typeof foodLogs.$inferSelect;
export type InsertFoodLog = z.infer<typeof insertFoodLogSchema>;

export type CreateFoodLogRequest = InsertFoodLog;
export type StatsResponse = {
  dailyCalories: number;
  dailyProtein: number;
  dailyFat: number;
  dailyCarbs: number;
  weeklyCalories: number[]; // Last 7 days
};
