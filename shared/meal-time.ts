/**
 * Приём пищи по времени суток — общий для сервера (повтор записи, избранное) и
 * Mini App (приём по умолчанию в «Добавить еду»). Повторяет логику промпта в
 * server/openai.ts: завтрак 05:00–breakfastEnd, обед до lunchEnd, иначе ужин.
 */
export type MealBoundaries = { breakfastEnd: string; lunchEnd: string };

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** По минутам от полуночи (уже в нужной таймзоне). Концы интервалов включительно. */
export function mealTypeByMinutes(
  totalMin: number,
  boundaries?: MealBoundaries,
): "breakfast" | "lunch" | "dinner" {
  const bfEndMin = toMinutes(boundaries?.breakfastEnd ?? "12:30");
  const lnEndMin = toMinutes(boundaries?.lunchEnd ?? "16:30");

  if (totalMin >= 300 && totalMin <= bfEndMin) return "breakfast";
  if (totalMin > bfEndMin && totalMin <= lnEndMin) return "lunch";
  return "dinner";
}

/**
 * То же по Date: читает ЛОКАЛЬНЫЕ часы (сервер передаёт сюда wallClockDate —
 * Date, чьи getHours() уже равны времени в зоне пользователя).
 */
export function mealTypeByTime(now: Date, boundaries?: MealBoundaries): "breakfast" | "lunch" | "dinner" {
  return mealTypeByMinutes(now.getHours() * 60 + now.getMinutes(), boundaries);
}
