/**
 * Unit tests for the "repeat meal" + favorites pure logic.
 * No server / DB needed — same functions used by server/bot.ts.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  mealTypeByTime,
  buildMealTitle,
  toFavoriteItems,
  sameTitle,
  shouldSuggestFavorite,
} from "../server/lib/favorites";

// Helper: a Date whose local wall-clock is HH:MM (matches how getUserNow builds it).
const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m, 0);

describe("mealTypeByTime", () => {
  test("morning → breakfast (default boundaries)", () => {
    assert.equal(mealTypeByTime(at(8, 0)), "breakfast");
    assert.equal(mealTypeByTime(at(12, 30)), "breakfast"); // inclusive end
  });

  test("midday → lunch", () => {
    assert.equal(mealTypeByTime(at(12, 31)), "lunch");
    assert.equal(mealTypeByTime(at(16, 30)), "lunch"); // inclusive end
  });

  test("evening → dinner", () => {
    assert.equal(mealTypeByTime(at(16, 31)), "dinner");
    assert.equal(mealTypeByTime(at(22, 0)), "dinner");
  });

  test("deep night (before 05:00) → dinner", () => {
    assert.equal(mealTypeByTime(at(3, 0)), "dinner");
  });

  test("custom boundaries shift the windows", () => {
    const b = { breakfastEnd: "10:00", lunchEnd: "15:00" };
    assert.equal(mealTypeByTime(at(10, 30), b), "lunch");
    assert.equal(mealTypeByTime(at(15, 30), b), "dinner");
    assert.equal(mealTypeByTime(at(9, 0), b), "breakfast");
  });
});

describe("buildMealTitle", () => {
  test("joins names with ' + '", () => {
    assert.equal(buildMealTitle(["Овсянка", "Кофе"]), "Овсянка + Кофе");
  });

  test("empty input → fallback", () => {
    assert.equal(buildMealTitle([]), "Приём пищи");
    assert.equal(buildMealTitle(["", "  "]), "Приём пищи");
  });

  test("trims blanks and keeps order", () => {
    assert.equal(buildMealTitle([" Яйца ", "Хлеб"]), "Яйца + Хлеб");
  });

  test("truncates long lists keeping whole names + ellipsis", () => {
    const names = ["Гречка с курицей", "Салат овощной", "Компот из сухофруктов", "Хлеб цельнозерновой"];
    const title = buildMealTitle(names, 40);
    assert.ok(title.length <= 42, `too long: ${title.length}`);
    assert.ok(title.endsWith("…"), `no ellipsis: ${title}`);
    assert.ok(title.startsWith("Гречка с курицей"), title);
    // No half-cut names: every kept segment is one of the originals.
    const kept = title.replace(" …", "").split(" + ");
    for (const seg of kept) assert.ok(names.includes(seg), `cut name: ${seg}`);
  });

  test("single over-long name is hard-truncated", () => {
    const long = "Оченьдлинноеназваниеблюдакотороенепомещается";
    const title = buildMealTitle([long], 20);
    assert.ok(title.length <= 20, `too long: ${title.length}`);
    assert.ok(title.endsWith("…"));
  });
});

describe("toFavoriteItems", () => {
  test("projects to favorite shape, rounds numbers, drops extras", () => {
    const items = toFavoriteItems([
      { foodName: "Каша", calories: 210.6, protein: 8.4, fat: 4.9, carbs: 35.2, weight: 250.7, foodScore: 8, nutritionAdvice: "x", fiber: 3 },
    ]);
    assert.deepEqual(items, [
      { foodName: "Каша", calories: 211, protein: 8, fat: 5, carbs: 35, weight: 251 },
    ]);
    assert.ok(!("foodScore" in items[0]));
  });

  test("keeps hydrating flag only when true", () => {
    const [drink] = toFavoriteItems([{ foodName: "Вода", calories: 0, protein: 0, fat: 0, carbs: 0, weight: 300, hydrating: true }]);
    assert.equal(drink.hydrating, true);
    const [food] = toFavoriteItems([{ foodName: "Хлеб", calories: 100, protein: 3, fat: 1, carbs: 20, weight: 40 }]);
    assert.ok(!("hydrating" in food));
  });

  test("coerces missing/NaN numbers to 0", () => {
    const [it] = toFavoriteItems([{ foodName: "X" }]);
    assert.deepEqual(it, { foodName: "X", calories: 0, protein: 0, fat: 0, carbs: 0, weight: 0 });
  });
});

describe("sameTitle", () => {
  test("case- and whitespace-insensitive", () => {
    assert.ok(sameTitle("Кофе", " кофе "));
    assert.ok(sameTitle("Овсянка + Кофе", "овсянка + кофе"));
    assert.ok(!sameTitle("Кофе", "Чай"));
  });
});

describe("shouldSuggestFavorite", () => {
  const base = { title: "Кофе", existingTitles: [] as string[], dismissedTitles: [] as string[] };

  test("suggests at/above threshold", () => {
    assert.ok(shouldSuggestFavorite({ ...base, recentCount: 3 }));
    assert.ok(shouldSuggestFavorite({ ...base, recentCount: 5 }));
  });

  test("does not suggest below threshold", () => {
    assert.ok(!shouldSuggestFavorite({ ...base, recentCount: 2 }));
  });

  test("does not suggest if already a favorite (case-insensitive)", () => {
    assert.ok(!shouldSuggestFavorite({ ...base, recentCount: 9, existingTitles: ["кофе"] }));
  });

  test("does not suggest if dismissed this session", () => {
    assert.ok(!shouldSuggestFavorite({ ...base, recentCount: 9, dismissedTitles: ["Кофе"] }));
  });

  test("custom threshold respected", () => {
    assert.ok(!shouldSuggestFavorite({ ...base, recentCount: 3, threshold: 5 }));
    assert.ok(shouldSuggestFavorite({ ...base, recentCount: 5, threshold: 5 }));
  });
});
