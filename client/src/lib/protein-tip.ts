/**
 * Подсказка на «Сегодня»: вечером, если до цели по белку далеко, а калории ещё
 * остались. Время суток — по таймзоне профиля, как и всё «сегодня» в Mini App.
 */
import { minutesInTimeZone } from "./date-tz";

/** Подсказываем, только если не хватает больше этого, г. */
const MIN_PROTEIN_GAP = 20;

export interface ProteinTipInput {
  protein: number;
  proteinGoal: number | null | undefined;
  calories: number;
  caloriesGoal: number | null | undefined;
  timezone: string | null | undefined;
  /** Конец обеда "HH:MM" из профиля; null → 16:30, как на сервере. */
  mealLunchEnd: string | null | undefined;
  now?: Date;
}

export function proteinTip(i: ProteinTipInput): string | null {
  if (!i.proteinGoal || i.proteinGoal <= 0) return null;
  const missing = Math.round(i.proteinGoal - i.protein);
  if (missing <= MIN_PROTEIN_GAP) return null;
  if (!i.caloriesGoal || i.caloriesGoal - i.calories <= 0) return null;

  const [h, m] = (i.mealLunchEnd || "16:30").split(":").map(Number);
  if (minutesInTimeZone(i.timezone, i.now) <= h * 60 + m) return null;

  return `На ужин добавьте белка: до цели не хватает ${missing} г.`;
}
