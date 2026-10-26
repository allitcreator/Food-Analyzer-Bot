/**
 * Карточка «Вес» в «Трендах»: текущий вес, изменение и точки графика. Берём
 * последние 30 дней; если в них меньше двух взвешиваний — весь период.
 */
import { addDaysISO, toISO } from "./format";

export interface WeightPoint {
  date: string;
  weight: number;
}

export interface WeightTrend {
  current: number;
  /** Последняя точка минус первая, кг с точностью 0,1; null — точка одна. */
  delta: number | null;
  points: WeightPoint[];
  /** true — точки за последние 30 дней, false — за весь период. */
  monthWindow: boolean;
}

const WINDOW_DAYS = 30;

/** `logs` — как отдаёт GET /weight: новые сверху. */
export function weightTrend(
  logs: { weight: number; date: string | null }[],
  now: Date = new Date(),
): WeightTrend | null {
  const all: WeightPoint[] = logs
    .filter((l) => l.date)
    .map((l) => ({ date: l.date!.slice(0, 10), weight: Math.round(l.weight * 10) / 10 }))
    .reverse();
  if (all.length === 0) return null;

  const since = addDaysISO(toISO(now), -WINDOW_DAYS);
  const recent = all.filter((p) => p.date >= since);
  const monthWindow = recent.length >= 2;
  const points = monthWindow ? recent : all;
  const current = all[all.length - 1].weight;
  const delta =
    points.length >= 2
      ? Math.round((points[points.length - 1].weight - points[0].weight) * 10) / 10
      : null;
  return { current, delta, points, monthWindow };
}
