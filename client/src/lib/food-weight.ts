/** Допустимый вес позиции в «Добавить еду», г/мл: больше нуля и не больше 5 кг. */
export const MAX_FOOD_WEIGHT = 5000;

export function isValidFoodWeight(w: number): boolean {
  return Number.isFinite(w) && w > 0 && w <= MAX_FOOD_WEIGHT;
}
