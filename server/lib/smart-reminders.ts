/**
 * Умные напоминания о пропущенном приёме пищи — чистая логика (без БД и
 * Telegram), поэтому юнит-тестируемая.
 *
 * Принцип «по факту, а не по расписанию»: обычное время каждого приёма
 * выводится из истории записей пользователя (медиана времени суток в его
 * таймзоне), а пинг шлётся только если приём реально не записан к этому времени.
 */

export type SmartMeal = "breakfast" | "lunch" | "dinner";

/** Приёмы, для которых считаем «обычное время»; snack сознательно игнорируем. */
const SMART_MEALS: SmartMeal[] = ["breakfast", "lunch", "dinner"];

/** Смещение окна пинга после медианы (мин): раньше median+30 не беспокоим. */
const WINDOW_START_OFFSET = 30;
/** Длина окна (мин): после median+30 у нас 2 часа, дальше — «догоняющий» пинг
 *  поздно ночью после простоя не шлём. */
const WINDOW_LENGTH = 120;
/** Минимум записей приёма, чтобы «обычное время» считалось устойчивым. */
const MIN_COUNT = 5;

/** Минуты суток (0..1439) для момента `date` в таймзоне `tz` (formatToParts). */
function minutesOfDayInTz(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  let hour = get("hour");
  if (hour === 24) hour = 0; // некоторые движки отдают 24 для полуночи при hour12:false
  return hour * 60 + get("minute");
}

/** Медиана (не мутирует вход). Для чётной длины — среднее двух центральных. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * «Обычное время» каждого приёма по истории: медиана минут суток (в таймзоне
 * пользователя) и число записей. Приёмы без записей в результат не попадают.
 * `now` — опорный момент «сейчас» (зарезервирован под будущую фильтрацию окна
 * истории; текущая реализация окно ограничивает на уровне выборки из БД).
 */
export function typicalMealTimes(
  logs: { date: Date; mealType: string }[],
  tz: string,
  now: Date,
): Partial<Record<SmartMeal, { medianMinutes: number; count: number }>> {
  void now;
  const byMeal: Record<SmartMeal, number[]> = { breakfast: [], lunch: [], dinner: [] };
  for (const log of logs) {
    if (log.mealType === "breakfast" || log.mealType === "lunch" || log.mealType === "dinner") {
      byMeal[log.mealType].push(minutesOfDayInTz(log.date, tz));
    }
  }
  const out: Partial<Record<SmartMeal, { medianMinutes: number; count: number }>> = {};
  for (const meal of SMART_MEALS) {
    const arr = byMeal[meal];
    if (arr.length > 0) {
      out[meal] = { medianMinutes: Math.round(median(arr)), count: arr.length };
    }
  }
  return out;
}

/**
 * Есть ли приём, о котором пора напомнить прямо сейчас. Правило:
 *   • у приёма ≥ MIN_COUNT записей (обычное время устойчиво);
 *   • приём ещё не записан сегодня;
 *   • median+30 ≤ nowMinutes ≤ median+30+120 (окно 2 часа).
 * Возвращает первый подходящий в порядке завтрак → обед → ужин, иначе null.
 * Окно само гасит «просроченный» завтрак к обеду, поэтому первый-в-порядке не
 * блокирует более поздние приёмы.
 */
export function dueSmartReminder(
  typical: Partial<Record<SmartMeal, { medianMinutes: number; count: number }>>,
  loggedMealsToday: Set<string>,
  nowMinutes: number,
): SmartMeal | null {
  for (const meal of SMART_MEALS) {
    const t = typical[meal];
    if (!t || t.count < MIN_COUNT) continue;
    if (loggedMealsToday.has(meal)) continue;
    const lo = t.medianMinutes + WINDOW_START_OFFSET;
    const hi = lo + WINDOW_LENGTH;
    if (nowMinutes >= lo && nowMinutes <= hi) return meal;
  }
  return null;
}

/** Минуты суток → "HH:MM" (с защитой от выхода за сутки и дробей). */
export function minutesToHHMM(minutes: number): string {
  const m = (((Math.round(minutes) % 1440) + 1440) % 1440);
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
