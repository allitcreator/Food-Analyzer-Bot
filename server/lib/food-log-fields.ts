/**
 * Округление ручной правки записи питания по типу колонки `food_logs`.
 *
 * calories/protein/fat/carbs/weight — integer (shared/schema.ts): дробь в них
 * Postgres не примет (`invalid input syntax for type integer`). Микронутриенты —
 * real, им хватает одного знака. Поля вне списка (id, userId, foodScore и т.п.)
 * правкой не меняются — для них `undefined`.
 */
const INTEGER_FIELDS = new Set(["calories", "protein", "fat", "carbs", "weight"]);
const REAL_FIELDS = new Set(["fiber", "sugar", "sodium", "saturatedFat"]);

export function roundFoodLogField(field: string, value: number): number | undefined {
  if (INTEGER_FIELDS.has(field)) return Math.round(value);
  if (REAL_FIELDS.has(field)) return Math.round(value * 10) / 10;
  return undefined;
}
