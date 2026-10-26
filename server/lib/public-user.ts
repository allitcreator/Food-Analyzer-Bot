/**
 * Профиль пользователя для Mini App (`GET /api/app/me`, ответы PATCH
 * /profile и /settings).
 *
 * Только поля, которые читает клиент (`MeResponse` в client/src/lib/types.ts).
 * Список явный: новая колонка в `users` наружу сама не уедет. Служебное —
 * `quickToken` (им авторизуется быстрая запись), `telegramId`, флаги доступа —
 * клиенту не отдаём.
 */
import type { User } from "@shared/schema";

export const PUBLIC_USER_FIELDS = [
  "age",
  "gender",
  "weight",
  "height",
  "activityLevel",
  "goal",
  "reportTime",
  "breakfastReminder",
  "lunchReminder",
  "dinnerReminder",
  "noLogReminderTime",
  "weightReminderTime",
  "weightReminderDays",
  "showMicronutrients",
  "aiWeekAnalysis",
  "aiMonthAnalysis",
  "aiEveningReport",
  "smartFoodGrouping",
  "barcodeScanEnabled",
  "smartReminders",
  "timezone",
  "mealBreakfastEnd",
  "mealLunchEnd",
] as const satisfies readonly (keyof User)[];

export type PublicUser = Pick<User, (typeof PUBLIC_USER_FIELDS)[number]>;

export function publicUser(user: User): PublicUser {
  const out = {} as Record<string, unknown>;
  for (const key of PUBLIC_USER_FIELDS) out[key] = user[key];
  return out as PublicUser;
}
