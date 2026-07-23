/** Small formatting / date helpers (Russian UI, integer nutrition values). */

export const round = (n: number | null | undefined): number =>
  Math.round(Number(n ?? 0));

export const clampPct = (value: number, goal: number | null | undefined): number => {
  if (!goal || goal <= 0) return 0;
  return Math.min(100, Math.max(0, (value / goal) * 100));
};

/** Local calendar date as "YYYY-MM-DD" (no timezone shift). */
export function todayISO(): string {
  return toISO(new Date());
}

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
const WEEKDAYS_RU = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

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

export function isToday(iso: string): boolean {
  return iso === todayISO();
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
