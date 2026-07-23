/**
 * Telegram Mini App REST API contracts (`/api/app/*`).
 *
 * Shared zod schemas for request validation. The server (`server/app-api.ts`)
 * validates incoming requests against these; the React client imports the
 * inferred types so both sides stay in sync.
 */
import { z } from "zod";

// ─── Primitives ──────────────────────────────────────────────────────────────

/** "HH:MM" 24-hour. */
export const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");

/** "HH:MM" or the literal "off" (reminders / report time). */
export const hhmmOrOff = z.union([hhmm, z.literal("off")]);

/** "YYYY-MM-DD". */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** Valid IANA timezone (validated via Intl). */
export const ianaTimezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "invalid IANA timezone");

/** Comma-separated JS weekday numbers 0..6 (e.g. "1,3,5"), or empty string. */
export const weekdayList = z.string().refine((s) => {
  if (s === "") return true;
  return s.split(",").every((p) => /^[0-6]$/.test(p.trim()));
}, 'expected comma-separated weekday numbers 0..6 (e.g. "1,3,5")');

export const genderEnum = z.enum(["male", "female"]);
export const activityEnum = z.enum([
  "sedentary",
  "light",
  "moderate",
  "active",
  "very_active",
]);
export const goalEnum = z.enum(["lose", "maintain", "gain"]);
export const mealTypeEnum = z.enum(["breakfast", "lunch", "dinner", "snack"]);

/** Path/query id coercion (positive integer). */
export const idParam = z.coerce.number().int().positive();

// ─── Query schemas ───────────────────────────────────────────────────────────

export const dayQuerySchema = z.object({
  date: isoDate.optional(),
});
export type DayQuery = z.infer<typeof dayQuerySchema>;

export const statsQuerySchema = z.object({
  range: z.enum(["week", "month"]).default("week"),
});
export type StatsQuery = z.infer<typeof statsQuerySchema>;

export const weightQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(365).default(90),
});
export type WeightQuery = z.infer<typeof weightQuerySchema>;

// ─── Body schemas ────────────────────────────────────────────────────────────

/** PATCH /api/app/logs/:id — client sends already-computed values. */
export const updateLogSchema = z
  .object({
    foodName: z.string().min(1).max(200).optional(),
    weight: z.number().int().min(0).max(20000).optional(),
    calories: z.number().int().min(0).max(50000).optional(),
    protein: z.number().int().min(0).max(2000).optional(),
    fat: z.number().int().min(0).max(2000).optional(),
    carbs: z.number().int().min(0).max(2000).optional(),
    mealType: mealTypeEnum.optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, "no fields to update");
export type UpdateLogBody = z.infer<typeof updateLogSchema>;

/** POST /api/app/water. */
export const waterSchema = z.object({
  amount: z.number().int().min(1).max(3000),
});
export type WaterBody = z.infer<typeof waterSchema>;

/** PATCH /api/app/profile. `recalc` re-derives goals via Mifflin-St Jeor. */
export const profilePatchSchema = z
  .object({
    age: z.number().int().min(1).max(120).optional(),
    weight: z.number().int().min(20).max(400).optional(),
    height: z.number().int().min(50).max(280).optional(),
    gender: genderEnum.optional(),
    activityLevel: activityEnum.optional(),
    goal: goalEnum.optional(),
    // Manual goal overrides.
    caloriesGoal: z.number().int().min(500).max(10000).optional(),
    proteinGoal: z.number().int().min(0).max(1000).optional(),
    fatGoal: z.number().int().min(0).max(1000).optional(),
    carbsGoal: z.number().int().min(0).max(2000).optional(),
    recalc: z.boolean().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, "no fields to update");
export type ProfilePatchBody = z.infer<typeof profilePatchSchema>;

/** PATCH /api/app/settings — toggles and times mirrored from /settings. */
export const settingsPatchSchema = z
  .object({
    showMicronutrients: z.boolean().optional(),
    aiWeekAnalysis: z.boolean().optional(),
    aiMonthAnalysis: z.boolean().optional(),
    aiEveningReport: z.boolean().optional(),
    smartFoodGrouping: z.boolean().optional(),
    barcodeScanEnabled: z.boolean().optional(),
    reportTime: hhmmOrOff.optional(),
    breakfastReminder: hhmmOrOff.optional(),
    lunchReminder: hhmmOrOff.optional(),
    dinnerReminder: hhmmOrOff.optional(),
    noLogReminderTime: hhmmOrOff.optional(),
    weightReminderTime: hhmmOrOff.optional(),
    weightReminderDays: weekdayList.optional(),
    timezone: ianaTimezone.optional(),
    mealBreakfastEnd: hhmm.optional(),
    mealLunchEnd: hhmm.optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, "no fields to update");
export type SettingsPatchBody = z.infer<typeof settingsPatchSchema>;

// ─── Response shapes (documentation / client typing) ─────────────────────────

export const goalsSchema = z.object({
  calories: z.number().nullable(),
  protein: z.number().nullable(),
  fat: z.number().nullable(),
  carbs: z.number().nullable(),
});
export type Goals = z.infer<typeof goalsSchema>;

export const dayTotalsSchema = z.object({
  calories: z.number(),
  protein: z.number(),
  fat: z.number(),
  carbs: z.number(),
  fiber: z.number(),
  sugar: z.number(),
  sodium: z.number(),
  saturatedFat: z.number(),
});
export type DayTotals = z.infer<typeof dayTotalsSchema>;

export const energyBalanceSchema = z
  .object({
    bmr: z.number(),
    tdee: z.number(),
    eaten: z.number(),
    burnedFromActivity: z.number(),
    balance: z.number(),
    isDeficit: z.boolean(),
    hasTracker: z.boolean(),
  })
  .nullable();
export type EnergyBalanceResponse = z.infer<typeof energyBalanceSchema>;
