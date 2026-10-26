/** Small formatting / date helpers (Russian UI, integer nutrition values). */

export const round = (n: number | null | undefined): number =>
  Math.round(Number(n ?? 0));

export const clampPct = (value: number, goal: number | null | undefined): number => {
  if (!goal || goal <= 0) return 0;
  return Math.min(100, Math.max(0, (value / goal) * 100));
};

/**
 * Local calendar date as "YYYY-MM-DD" (no timezone shift). Для «сегодня»
 * используйте todayInTimeZone из ./date-tz — сервер считает день по таймзоне
 * профиля, а не по часам устройства.
 */
export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysISO(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + delta);
  return toISO(date);
}

const MONTHS_RU = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const MONTHS_SHORT_RU = [
  "янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];
const WEEKDAYS_RU = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const WEEKDAYS_FULL_RU = [
  "Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота",
];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function parseISO(iso: string): { date: Date; d: number; m: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { date: new Date(y, m - 1, d), d, m };
}

/** "Пн" — подпись столбика недели. */
export function weekdayShort(iso: string): string {
  return capitalize(WEEKDAYS_RU[parseISO(iso).date.getDay()]);
}

/** "Пн, 26 октября" — заголовок «Сегодня». */
export function formatDayTitle(iso: string): string {
  const { d, m } = parseISO(iso);
  return `${weekdayShort(iso)}, ${d} ${MONTHS_RU[m - 1]}`;
}

/** "Суббота, 24 октября" — карточка дня в «Истории». */
export function formatDateLong(iso: string): string {
  const { date, d, m } = parseISO(iso);
  return `${WEEKDAYS_FULL_RU[date.getDay()]}, ${d} ${MONTHS_RU[m - 1]}`;
}

/** "20–26 октября" или "28 сентября – 4 октября". */
export function formatDateRange(startIso: string, endIso: string): string {
  const a = parseISO(startIso);
  const b = parseISO(endIso);
  if (a.m === b.m) return `${a.d}–${b.d} ${MONTHS_RU[b.m - 1]}`;
  return `${a.d} ${MONTHS_RU[a.m - 1]} – ${b.d} ${MONTHS_RU[b.m - 1]}`;
}

/** "28 сен" — подписи оси графика веса. */
export function formatDayMonthShort(iso: string): string {
  const { d, m } = parseISO(iso);
  return `${d} ${MONTHS_SHORT_RU[m - 1]}`;
}

/** "23 июля, пн" from an ISO date. */
export function formatDateHuman(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${d} ${MONTHS_RU[m - 1]}, ${WEEKDAYS_RU[date.getDay()]}`;
}

/** Short label for charts: "23.07". */
export function formatDateShort(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}`;
}

export const MEAL_LABELS: Record<string, string> = {
  breakfast: "Завтрак",
  lunch: "Обед",
  dinner: "Ужин",
  snack: "Перекус",
};

export const MEAL_ORDER = ["breakfast", "lunch", "dinner", "snack"] as const;

export const ACTIVITY_LABELS: Record<string, string> = {
  sedentary: "Сидячий",
  light: "Лёгкая активность",
  moderate: "Умеренная",
  active: "Активный",
  very_active: "Очень активный",
};

export const GOAL_LABELS: Record<string, string> = {
  lose: "Похудение",
  maintain: "Поддержание",
  gain: "Набор массы",
};

export const GENDER_LABELS: Record<string, string> = {
  male: "Мужской",
  female: "Женский",
};
