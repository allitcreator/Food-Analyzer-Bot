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
import { createFavoriteSchema, updateFavoriteSchema } from "../shared/routes";
import {
  matchesFavoriteQuery,
  filterFavorites,
  sameFavoriteTitle,
  hasFavoriteTitle,
} from "../shared/favorites-filter";

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

describe("createFavoriteSchema (POST /api/app/favorites)", () => {
  const item = {
    foodName: "Овсянка",
    calories: 300,
    protein: 10,
    fat: 6,
    carbs: 50,
    weight: 250,
  };

  test("accepts a valid single-item favorite", () => {
    const parsed = createFavoriteSchema.parse({ title: "Завтрак", items: [item] });
    assert.equal(parsed.title, "Завтрак");
    assert.equal(parsed.items.length, 1);
  });

  test("trims the title", () => {
    const parsed = createFavoriteSchema.parse({ title: "  Обед  ", items: [item] });
    assert.equal(parsed.title, "Обед");
  });

  test("keeps the optional hydrating flag", () => {
    const parsed = createFavoriteSchema.parse({
      title: "Кофе",
      items: [{ ...item, foodName: "Кофе", hydrating: true }],
    });
    assert.equal(parsed.items[0].hydrating, true);
  });

  test("rejects an empty title", () => {
    assert.throws(() => createFavoriteSchema.parse({ title: "", items: [item] }));
  });

  test("rejects an empty items array", () => {
    assert.throws(() => createFavoriteSchema.parse({ title: "X", items: [] }));
  });

  test("rejects non-integer / out-of-range macros", () => {
    assert.throws(() =>
      createFavoriteSchema.parse({ title: "X", items: [{ ...item, calories: 1.5 }] }),
    );
    assert.throws(() =>
      createFavoriteSchema.parse({ title: "X", items: [{ ...item, weight: -1 }] }),
    );
  });

  test("rejects unknown item fields (strict)", () => {
    assert.throws(() =>
      createFavoriteSchema.parse({ title: "X", items: [{ ...item, foodScore: 5 }] }),
    );
  });
});

describe("updateFavoriteSchema (PATCH /api/app/favorites/:id)", () => {
  test("accepts a boolean isShared", () => {
    assert.equal(updateFavoriteSchema.parse({ isShared: true }).isShared, true);
    assert.equal(updateFavoriteSchema.parse({ isShared: false }).isShared, false);
  });

  test("rejects a missing or non-boolean isShared", () => {
    assert.throws(() => updateFavoriteSchema.parse({}));
    assert.throws(() => updateFavoriteSchema.parse({ isShared: "yes" }));
  });

  test("rejects unknown fields (strict)", () => {
    assert.throws(() => updateFavoriteSchema.parse({ isShared: true, title: "X" }));
  });
});

describe("matchesFavoriteQuery / filterFavorites (Mini App search)", () => {
  const favs = [
    { title: "Завтрак", items: [{ foodName: "Овсянка" }, { foodName: "Кофе" }] },
    { title: "Обед", items: [{ foodName: "Гречка с курицей" }] },
    { title: "Перекус", items: [{ foodName: "Яблоко" }] },
  ];

  test("empty / whitespace query matches everything", () => {
    assert.ok(matchesFavoriteQuery(favs[0], ""));
    assert.ok(matchesFavoriteQuery(favs[0], "   "));
    assert.equal(filterFavorites(favs, "").length, 3);
  });

  test("matches on title (case-insensitive)", () => {
    assert.ok(matchesFavoriteQuery(favs[0], "завтрак"));
    assert.deepEqual(filterFavorites(favs, "обед").map((f) => f.title), ["Обед"]);
  });

  test("matches on an item name", () => {
    assert.ok(matchesFavoriteQuery(favs[1], "курица".slice(0, 4))); // "кури"
    assert.deepEqual(filterFavorites(favs, "кофе").map((f) => f.title), ["Завтрак"]);
  });

  test("no match → filtered out", () => {
    assert.ok(!matchesFavoriteQuery(favs[2], "пицца"));
    assert.equal(filterFavorites(favs, "пицца").length, 0);
  });

  test("trims the query before matching", () => {
    assert.deepEqual(filterFavorites(favs, "  яблоко  ").map((f) => f.title), ["Перекус"]);
  });
});

describe("sameFavoriteTitle / hasFavoriteTitle (dedup)", () => {
  test("case- and whitespace-insensitive equality", () => {
    assert.ok(sameFavoriteTitle("Кофе", " кофе "));
    assert.ok(sameFavoriteTitle("Овсянка + Кофе", "овсянка + кофе"));
    assert.ok(!sameFavoriteTitle("Кофе", "Чай"));
  });

  test("hasFavoriteTitle finds an existing title regardless of case/spaces", () => {
    const titles = ["Завтрак", "Обед"];
    assert.ok(hasFavoriteTitle(titles, "  завтрак "));
    assert.ok(hasFavoriteTitle(titles, "ОБЕД"));
    assert.ok(!hasFavoriteTitle(titles, "Ужин"));
    assert.ok(!hasFavoriteTitle([], "Завтрак"));
  });
});
