/**
 * Unit tests for the pure "rescale food item by weight" logic used on the
 * confirmation step of the Mini App "Добавить еду" flow. No browser / DB.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scaleFoodByWeight } from "../shared/food-scale";
import { analyzedItemSchema } from "../shared/routes";

const base = {
  foodName: "Овсянка",
  calories: 200,
  protein: 8,
  fat: 4,
  carbs: 36,
  weight: 100,
  mealType: "breakfast" as const,
  fiber: 5,
  sugar: 2,
  sodium: 10,
  saturatedFat: 1,
};

describe("scaleFoodByWeight", () => {
  test("doubling the weight doubles every nutrient", () => {
    const out = scaleFoodByWeight(base, 200);
    assert.equal(out.weight, 200);
    assert.equal(out.calories, 400);
    assert.equal(out.protein, 16);
    assert.equal(out.fat, 8);
    assert.equal(out.carbs, 72);
    assert.equal(out.fiber, 10);
    assert.equal(out.sugar, 4);
    assert.equal(out.sodium, 20);
    assert.equal(out.saturatedFat, 2);
  });

  test("halving the weight halves nutrients", () => {
    const out = scaleFoodByWeight(base, 50);
    assert.equal(out.weight, 50);
    assert.equal(out.calories, 100);
    assert.equal(out.protein, 4);
  });

  test("scaling from the original is exact regardless of prior edits", () => {
    // UI хранит оригинал и всегда считает от него — какой бы вес ни выставляли
    // до этого, результат для веса N совпадает с одним прямым пересчётом base→N.
    scaleFoodByWeight(base, 33); // «промежуточная» правка веса ни на что не влияет
    scaleFoodByWeight(base, 777);
    const direct = scaleFoodByWeight(base, 250);
    assert.equal(direct.calories, 500);
    assert.equal(direct.weight, 250);
  });

  test("keeps non-numeric fields untouched", () => {
    const withMeta = { ...base, foodScore: 8, nutritionAdvice: "x", hydrating: false };
    const out = scaleFoodByWeight(withMeta, 150);
    assert.equal(out.foodName, "Овсянка");
    assert.equal(out.mealType, "breakfast");
    assert.equal(out.foodScore, 8);
    assert.equal(out.nutritionAdvice, "x");
    assert.equal(out.hydrating, false);
  });

  test("preserves null micronutrients (does not turn null into 0)", () => {
    const out = scaleFoodByWeight({ ...base, fiber: null, sodium: null }, 200);
    assert.equal(out.fiber, null);
    assert.equal(out.sodium, null);
    assert.equal(out.sugar, 4); // the defined ones still scale
  });

  test("zero base weight → macros kept, only weight updated (no divide by zero)", () => {
    const out = scaleFoodByWeight({ ...base, weight: 0 }, 120);
    assert.equal(out.weight, 120);
    assert.equal(out.calories, 200); // unchanged
  });

  test("invalid new weight is ignored, original weight kept", () => {
    const out = scaleFoodByWeight(base, Number.NaN);
    assert.equal(out.weight, 100);
    assert.equal(out.calories, 200);
  });

  test("scaled item still passes the POST /logs item schema", () => {
    const out = scaleFoodByWeight(base, 175);
    // Zod для позиции допускает нецелые числа — округление на сервере при записи.
    assert.doesNotThrow(() => analyzedItemSchema.parse(out));
  });
});

describe("analyzedItemSchema (POST /api/app/logs)", () => {
  test("accepts finite non-integer macros", () => {
    const parsed = analyzedItemSchema.parse({ ...base, calories: 210.7, protein: 8.3 });
    assert.equal(parsed.calories, 210.7);
  });

  test("accepts nullable micronutrients / foodScore", () => {
    const parsed = analyzedItemSchema.parse({
      ...base,
      foodScore: null,
      fiber: null,
      nutritionAdvice: null,
    });
    assert.equal(parsed.foodScore, null);
    assert.equal(parsed.fiber, null);
  });

  test("rejects out-of-range and non-finite numbers", () => {
    assert.throws(() => analyzedItemSchema.parse({ ...base, calories: 10001 }));
    assert.throws(() => analyzedItemSchema.parse({ ...base, protein: 5001 }));
    assert.throws(() => analyzedItemSchema.parse({ ...base, calories: Infinity }));
    assert.throws(() => analyzedItemSchema.parse({ ...base, calories: -1 }));
  });

  test("rejects a bad mealType and unknown fields (strict)", () => {
    assert.throws(() => analyzedItemSchema.parse({ ...base, mealType: "brunch" }));
    assert.throws(() => analyzedItemSchema.parse({ ...base, extra: 1 }));
  });
});
