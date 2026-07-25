/**
 * Пропорциональный пересчёт распознанной AI позиции по весу.
 *
 * Держим чистой и без зависимостей, чтобы переиспользовать в React (шаг
 * подтверждения в Mini App) и покрыть юнит-тестом без браузера. Клиент хранит
 * ИСХОДНУЮ позицию и всегда считает от неё — так округления не накапливаются при
 * многократной правке веса. Микронутриенты (nullable) масштабируются только
 * когда заданы; поля-не-числа (foodName, mealType, foodScore …) не трогаем.
 */
export interface ScalableFood {
  weight: number;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber?: number | null;
  sugar?: number | null;
  sodium?: number | null;
  saturatedFat?: number | null;
}

/** Вернуть копию `original` с новым весом и пропорционально пересчитанными БЖУ. */
export function scaleFoodByWeight<T extends ScalableFood>(original: T, newWeight: number): T {
  const w = Number(newWeight);
  const base = Number(original.weight);
  // Некорректная база (0/NaN/отрицательная) — масштаб не определён: оставляем
  // макросы как есть, но применяем валидный новый вес, если он валиден.
  const safeWeight = Number.isFinite(w) && w >= 0 ? w : original.weight;
  if (!Number.isFinite(w) || w < 0 || !Number.isFinite(base) || base <= 0) {
    return { ...original, weight: safeWeight };
  }
  const k = w / base;
  const scale = (v: number | null | undefined): number | null | undefined =>
    v == null ? v : v * k;
  return {
    ...original,
    weight: w,
    calories: original.calories * k,
    protein: original.protein * k,
    fat: original.fat * k,
    carbs: original.carbs * k,
    fiber: scale(original.fiber),
    sugar: scale(original.sugar),
    sodium: scale(original.sodium),
    saturatedFat: scale(original.saturatedFat),
  };
}
