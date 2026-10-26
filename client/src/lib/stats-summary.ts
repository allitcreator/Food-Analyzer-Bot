/**
 * Сводки по дням для «Сегодня» и «Трендов». Дни без записей (0 ккал) в
 * среднее и минимум не входят — иначе пропущенный день выглядит как «голодовка».
 */
interface CaloriesRow {
  calories: number;
}

interface MacrosRow extends CaloriesRow {
  protein: number;
  fat: number;
  carbs: number;
}

const active = <T extends CaloriesRow>(rows: T[]) => rows.filter((r) => r.calories > 0);

export function averageCalories(rows: CaloriesRow[]): number | null {
  const a = active(rows);
  if (a.length === 0) return null;
  return Math.round(a.reduce((s, r) => s + r.calories, 0) / a.length);
}

export function averageMacros(
  rows: MacrosRow[],
): { protein: number; fat: number; carbs: number } | null {
  const a = active(rows);
  if (a.length === 0) return null;
  const avg = (key: "protein" | "fat" | "carbs") =>
    Math.round(a.reduce((s, r) => s + r[key], 0) / a.length);
  return { protein: avg("protein"), fat: avg("fat"), carbs: avg("carbs") };
}

/** Самый «лёгкий» и самый «тяжёлый» день; при равенстве — более ранний. */
export function calorieExtremes<T extends CaloriesRow>(rows: T[]): { min: T; max: T } | null {
  const a = active(rows);
  if (a.length === 0) return null;
  let min = a[0];
  let max = a[0];
  for (const r of a) {
    if (r.calories < min.calories) min = r;
    if (r.calories > max.calories) max = r;
  }
  return { min, max };
}

/**
 * Строки без дня `day` — сегодняшний день ещё не закончен, и в среднем или
 * минимуме недели он выглядел бы «лёгким». Строки без даты (недели) остаются.
 */
export function withoutDay<T extends { date?: string }>(rows: T[], day: string): T[] {
  return rows.filter((r) => r.date !== day);
}
