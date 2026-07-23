/**
 * Client-side types for the `/api/app/*` REST API.
 *
 * Request bodies and the plain value objects (goals / totals / energyBalance)
 * are imported straight from the shared zod contracts. Entity rows are declared
 * locally because over the wire `date`/`createdAt` are ISO strings (JSON), not
 * the `Date` objects that Drizzle's `$inferSelect` types describe.
 */
import type {
  Goals,
  DayTotals,
  EnergyBalanceResponse,
  UpdateLogBody,
  WaterBody,
  ProfilePatchBody,
  SettingsPatchBody,
} from "@shared/routes";

export type {
  Goals,
  DayTotals,
  EnergyBalanceResponse,
  UpdateLogBody,
  WaterBody,
  ProfilePatchBody,
  SettingsPatchBody,
};

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type Gender = "male" | "female";
export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "active"
  | "very_active";
export type GoalType = "lose" | "maintain" | "gain";

export interface FoodLog {
  id: number;
  userId: number;
  foodName: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  weight: number;
  mealType: string;
  foodScore: number | null;
  nutritionAdvice: string | null;
  fiber: number | null;
  sugar: number | null;
  sodium: number | null;
  saturatedFat: number | null;
  date: string | null;
}

export interface WaterLog {
  id: number;
  userId: number;
  amount: number;
  date: string | null;
}

export interface WeightLog {
  id: number;
  userId: number;
  weight: number;
  date: string | null;
}

export interface WorkoutLog {
  id: number;
  userId: number;
  description: string;
  workoutType: string;
  durationMin: number | null;
  caloriesBurned: number;
  source: string | null;
  date: string | null;
}

/** GET /me and PATCH /profile|/settings — user profile without server secrets. */
export interface MeResponse {
  id: number;
  telegramId: string | null;
  username: string | null;
  isApproved: boolean | null;
  isAdmin: boolean | null;
  isBlocked: boolean | null;
  age: number | null;
  gender: string | null;
  weight: number | null;
  height: number | null;
  activityLevel: string | null;
  goal: string | null;
  caloriesGoal: number | null;
  proteinGoal: number | null;
  fatGoal: number | null;
  carbsGoal: number | null;
  reportTime: string | null;
  breakfastReminder: string | null;
  lunchReminder: string | null;
  dinnerReminder: string | null;
  noLogReminderTime: string | null;
  weightReminderTime: string | null;
  weightReminderDays: string | null;
  showMicronutrients: boolean | null;
  aiWeekAnalysis: boolean | null;
  aiMonthAnalysis: boolean | null;
  aiEveningReport: boolean | null;
  smartFoodGrouping: boolean | null;
  barcodeScanEnabled: boolean | null;
  timezone: string | null;
  mealBreakfastEnd: string | null;
  mealLunchEnd: string | null;
  createdAt: string | null;
  goals: Goals;
}

export interface DayResponse {
  date: string;
  foodLogs: FoodLog[];
  waterTotal: number;
  waterLogs: WaterLog[];
  workouts: WorkoutLog[];
  totals: DayTotals;
  goals: Goals;
  energyBalance: EnergyBalanceResponse;
}

export interface WeekDayStat {
  date: string;
  dayLabel: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface MonthWeekStat {
  weekLabel: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  days: number;
}

export interface WeekStatsResponse {
  range: "week";
  streak: number;
  days: WeekDayStat[];
}

export interface MonthStatsResponse {
  range: "month";
  streak: number;
  weeks: MonthWeekStat[];
}

export type StatsResponse = WeekStatsResponse | MonthStatsResponse;

export interface WeightResponse {
  logs: WeightLog[];
}
