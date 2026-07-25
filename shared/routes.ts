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

/** One item inside a favorite (mirrors `FavoriteItem` in shared/schema.ts). */
export const favoriteItemSchema = z
  .object({
    foodName: z.string().min(1).max(200),
    calories: z.number().int().min(0).max(50000),
    protein: z.number().int().min(0).max(2000),
    fat: z.number().int().min(0).max(2000),
    carbs: z.number().int().min(0).max(2000),
    weight: z.number().int().min(0).max(20000),
    hydrating: z.boolean().optional(),
  })
  .strict();
export type FavoriteItemInput = z.infer<typeof favoriteItemSchema>;

/** POST /api/app/favorites — save a meal/dish for one-tap repeat later. */
export const createFavoriteSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    items: z.array(favoriteItemSchema).min(1).max(50),
  })
  .strict();
export type CreateFavoriteBody = z.infer<typeof createFavoriteSchema>;

/** PATCH /api/app/favorites/:id — owner toggles sharing to all users. */
export const updateFavoriteSchema = z
  .object({
    isShared: z.boolean(),
  })
  .strict();
export type UpdateFavoriteBody = z.infer<typeof updateFavoriteSchema>;

/**
 * POST /api/app/analyze — AI-распознавание еды из Mini App. Ровно одно из полей:
 * `text` (описание) ИЛИ `imageBase64` (сжатое на клиенте фото, base64 БЕЗ
 * data:-префикса). Ничего не пишет в БД — только возвращает распознанные позиции.
 */
export const analyzeSchema = z
  .object({
    text: z.string().trim().min(1).max(2000).optional(),
    imageBase64: z
      .string()
      .min(1)
      .max(1_400_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, "expected base64")
      .optional(),
  })
  .strict()
  .refine(
    (o) => (o.text ? 1 : 0) + (o.imageBase64 ? 1 : 0) === 1,
    "provide exactly one of text or imageBase64",
  );
export type AnalyzeBody = z.infer<typeof analyzeSchema>;

/**
 * Одна подтверждённая пользователем позиция для POST /api/app/logs. В отличие от
 * `favoriteItemSchema` числа НЕ целые (клиент пересчитывает БЖУ пропорционально
 * весу) и несёт полный набор полей `FoodItem` — сервер сохраняет их как есть.
 */
export const analyzedItemSchema = z
  .object({
    foodName: z.string().min(1).max(200),
    calories: z.number().finite().min(0).max(10000),
    protein: z.number().finite().min(0).max(5000),
    fat: z.number().finite().min(0).max(5000),
    carbs: z.number().finite().min(0).max(5000),
    weight: z.number().finite().min(0).max(5000),
    mealType: mealTypeEnum,
    hydrating: z.boolean().optional(),
    foodScore: z.number().int().min(1).max(10).nullable().optional(),
    nutritionAdvice: z.string().max(500).nullable().optional(),
    fiber: z.number().finite().min(0).nullable().optional(),
    sugar: z.number().finite().min(0).nullable().optional(),
    sodium: z.number().finite().min(0).nullable().optional(),
    saturatedFat: z.number().finite().min(0).nullable().optional(),
  })
  .strict();
export type AnalyzedItemInput = z.infer<typeof analyzedItemSchema>;

/** POST /api/app/logs — записать подтверждённые позиции в дневник/воду. */
export const createLogsSchema = z
  .object({
    items: z.array(analyzedItemSchema).min(1).max(20),
  })
  .strict();
export type CreateLogsBody = z.infer<typeof createLogsSchema>;

/** PATCH /api/app/settings — toggles and times mirrored from /settings. */
export const settingsPatchSchema = z
  .object({
    showMicronutrients: z.boolean().optional(),
    aiWeekAnalysis: z.boolean().optional(),
    aiMonthAnalysis: z.boolean().optional(),
    aiEveningReport: z.boolean().optional(),
    smartFoodGrouping: z.boolean().optional(),
    barcodeScanEnabled: z.boolean().optional(),
    smartReminders: z.boolean().optional(),
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
  })
  .nullable();
export type EnergyBalanceResponse = z.infer<typeof energyBalanceSchema>;
