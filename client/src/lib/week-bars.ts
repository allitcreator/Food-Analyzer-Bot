/**
 * Столбики недели на «Сегодня», в «Истории» и «Трендах»: цвет по доле от цели
 * калорий и высота столбика. Цвета тонов — токены --wk-* в index.css.
 */
export type WeekBarTone = "empty" | "today" | "ok" | "near" | "over" | "neutral";

/** «Около цели» — до +10% сверху, дальше перебор. */
const NEAR_LIMIT = 1.1;

export function weekBarTone(
  calories: number,
  goal: number | null | undefined,
  isToday: boolean,
): WeekBarTone {
  if (calories <= 0) return "empty";
  if (isToday) return "today";
  if (!goal || goal <= 0) return "neutral";
  const ratio = calories / goal;
  if (ratio <= 1) return "ok";
  if (ratio <= NEAR_LIMIT) return "near";
  return "over";
}

/** Высота 0..1: доля цели с потолком 1; без цели — относительно максимума недели. */
export function weekBarHeight(
  calories: number,
  goal: number | null | undefined,
  weekMax: number,
): number {
  if (calories <= 0) return 0;
  const base = goal && goal > 0 ? goal : weekMax;
  if (base <= 0) return 0;
  return Math.min(1, calories / base);
}

/** Tailwind-класс заливки столбика для тона. */
export const WEEK_TONE_BG: Record<WeekBarTone, string> = {
  empty: "bg-transparent",
  today: "bg-wk-today",
  ok: "bg-wk-ok",
  near: "bg-wk-near",
  over: "bg-wk-over",
  neutral: "bg-wk-ok",
};

/** CSS-переменная цвета тона — для recharts, которому нужен fill-цвет. */
export const WEEK_TONE_VAR: Record<WeekBarTone, string> = {
  empty: "--fill",
  today: "--wk-today",
  ok: "--wk-ok",
  near: "--wk-near",
  over: "--wk-over",
  neutral: "--wk-ok",
};
