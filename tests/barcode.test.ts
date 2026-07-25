/**
 * Tests for deterministic barcode decoding.
 *   - isValidEanChecksum: pure check-digit validation.
 *   - decodeBarcodeFromImage: round-trip through zxing-wasm writer → reader.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  decodeBarcodeFromImage,
  isValidEanChecksum,
  classifyHydratingProduct,
  barcodeCacheToFoodItem,
  foodItemToBarcodeCache,
} from "../server/barcode";

describe("isValidEanChecksum", () => {
  test("valid EAN-13", () => {
    assert.equal(isValidEanChecksum("4600682000037"), true);
  });

  test("valid EAN-8", () => {
    // data 4600986 → check digit 9
    assert.equal(isValidEanChecksum("46009869"), true);
  });

  test("valid UPC-A (12 digits)", () => {
    assert.equal(isValidEanChecksum("036000291452"), true);
  });

  test("invalid: wrong check digit", () => {
    assert.equal(isValidEanChecksum("4600682000038"), false);
  });

  test("invalid: digits permuted", () => {
    // same digits as valid 4600682000037, two swapped → checksum breaks
    assert.equal(isValidEanChecksum("4600628000037"), false);
  });

  test("invalid: contains letters", () => {
    assert.equal(isValidEanChecksum("460068200003X"), false);
  });

  test("invalid: wrong length", () => {
    assert.equal(isValidEanChecksum("12345"), false);
    assert.equal(isValidEanChecksum("460068200003"), false); // 12 digits but not a valid UPC-A
  });
});

describe("classifyHydratingProduct", () => {
  test("plain still water by category tag → hydrating", () => {
    assert.equal(classifyHydratingProduct({ categoriesTags: ["en:beverages", "en:waters"] }), true);
  });

  test("mineral / sparkling water by category tag → hydrating", () => {
    assert.equal(classifyHydratingProduct({ categoriesTags: ["en:mineral-waters"] }), true);
    assert.equal(classifyHydratingProduct({ categoriesTags: ["en:spring-waters"] }), true);
  });

  test("water tag wins even if some energy is reported", () => {
    assert.equal(
      classifyHydratingProduct({ categoriesTags: ["en:waters"], energyKcal100g: 3, sugars100g: 0 }),
      true,
    );
  });

  test("unsweetened beverage (0 kcal, 0 sugar) → hydrating", () => {
    // e.g. black tea / coffee without sugar
    assert.equal(
      classifyHydratingProduct({ categoriesTags: ["en:beverages"], energyKcal100g: 1, sugars100g: 0 }),
      true,
    );
  });

  test("beverage with low energy and missing sugar data → hydrating", () => {
    assert.equal(
      classifyHydratingProduct({ categoriesTags: ["en:beverages"], energyKcal100g: 2, sugars100g: null }),
      true,
    );
  });

  test("sweet soda (caloric beverage) → NOT hydrating", () => {
    assert.equal(
      classifyHydratingProduct({ categoriesTags: ["en:beverages", "en:sodas"], energyKcal100g: 42, sugars100g: 10.6 }),
      false,
    );
  });

  test("juice → NOT hydrating", () => {
    assert.equal(
      classifyHydratingProduct({ categoriesTags: ["en:beverages", "en:fruit-juices"], energyKcal100g: 46, sugars100g: 10 }),
      false,
    );
  });

  test("beverage with low energy but noticeable sugar → NOT hydrating", () => {
    assert.equal(
      classifyHydratingProduct({ categoriesTags: ["en:beverages"], energyKcal100g: 4, sugars100g: 3 }),
      false,
    );
  });

  test("beverage with unknown energy → NOT hydrating", () => {
    assert.equal(
      classifyHydratingProduct({ categoriesTags: ["en:beverages"], energyKcal100g: null, sugars100g: null }),
      false,
    );
  });

  test("solid food (not a beverage) → NOT hydrating", () => {
    assert.equal(
      classifyHydratingProduct({ categoriesTags: ["en:snacks"], energyKcal100g: 0, sugars100g: 0 }),
      false,
    );
  });

  test("no category tags → NOT hydrating", () => {
    assert.equal(classifyHydratingProduct({}), false);
    assert.equal(classifyHydratingProduct({ categoriesTags: null }), false);
  });

  test("case-insensitive category tags", () => {
    assert.equal(classifyHydratingProduct({ categoriesTags: ["EN:WATERS"] }), true);
  });
});

describe("barcodeCacheToFoodItem", () => {
  const rec = {
    barcode: "4600682000037",
    foodName: "Сгущёнка",
    caloriesPer100: 320,
    proteinPer100: 7.2,
    fatPer100: 8.5,
    carbsPer100: 55,
    defaultWeight: 40,
    hydrating: false,
    source: "vision",
  };

  test("recomputes КБЖУ on the cached default weight", () => {
    const item = barcodeCacheToFoodItem(rec);
    assert.equal(item.foodName, "Сгущёнка");
    assert.equal(item.weight, 40);
    assert.equal(item.calories, Math.round(320 * 0.4)); // 128
    assert.equal(item.protein, Math.round(7.2 * 0.4)); // 3
    assert.equal(item.fat, Math.round(8.5 * 0.4)); // 3
    assert.equal(item.carbs, Math.round(55 * 0.4)); // 22
    assert.equal(item.mealType, "snack");
    assert.equal(item.foundInDb, true);
    assert.equal(item.barcode, "4600682000037");
    assert.equal(item.hydrating, false);
  });

  test("recomputes on an explicit override weight", () => {
    const item = barcodeCacheToFoodItem(rec, 100);
    assert.equal(item.weight, 100);
    assert.equal(item.calories, 320);
    assert.equal(item.protein, 7); // round(7.2)
    assert.equal(item.carbs, 55);
  });

  test("non-positive override weight falls back to defaultWeight", () => {
    assert.equal(barcodeCacheToFoodItem(rec, 0).weight, 40);
    assert.equal(barcodeCacheToFoodItem(rec, -5).weight, 40);
  });

  test("carries the hydrating flag through", () => {
    const water = { ...rec, foodName: "Вода", caloriesPer100: 0, proteinPer100: 0, fatPer100: 0, carbsPer100: 0, defaultWeight: 500, hydrating: true };
    const item = barcodeCacheToFoodItem(water);
    assert.equal(item.hydrating, true);
    assert.equal(item.weight, 500);
    assert.equal(item.calories, 0);
  });
});

describe("foodItemToBarcodeCache", () => {
  test("normalizes КБЖУ to per-100 and keeps weight as defaultWeight", () => {
    const rec = foodItemToBarcodeCache(
      { foodName: "Батончик", calories: 128, protein: 3, fat: 3.4, carbs: 22, weight: 40 },
      "4600682000037",
      "vision",
    );
    assert.ok(rec);
    assert.equal(rec!.barcode, "4600682000037");
    assert.equal(rec!.source, "vision");
    assert.equal(rec!.defaultWeight, 40);
    assert.equal(rec!.caloriesPer100, 320); // 128 / 40 * 100
    assert.equal(rec!.proteinPer100, 7.5); // 3 / 40 * 100
    assert.equal(rec!.fatPer100, 8.5); // 3.4 / 40 * 100
    assert.equal(rec!.carbsPer100, 55); // 22 / 40 * 100
    assert.equal(rec!.hydrating, false);
  });

  test("round-trips through barcodeCacheToFoodItem", () => {
    const original = { foodName: "X", calories: 200, protein: 10, fat: 5, carbs: 30, weight: 50, hydrating: false };
    const rec = foodItemToBarcodeCache(original, "1234567890128", "vision")!;
    const back = barcodeCacheToFoodItem(rec);
    assert.equal(back.weight, 50);
    assert.equal(back.calories, 200);
    assert.equal(back.protein, 10);
    assert.equal(back.fat, 5);
    assert.equal(back.carbs, 30);
  });

  test("defaults hydrating from the item flag", () => {
    const rec = foodItemToBarcodeCache(
      { foodName: "Вода", calories: 0, protein: 0, fat: 0, carbs: 0, weight: 500, hydrating: true },
      "48000009",
      "off",
    );
    assert.equal(rec!.hydrating, true);
    assert.equal(rec!.source, "off");
  });

  test("returns null when weight is zero or invalid (cannot normalize)", () => {
    assert.equal(foodItemToBarcodeCache({ foodName: "X", calories: 1, protein: 1, fat: 1, carbs: 1, weight: 0 }, "b", "vision"), null);
    assert.equal(foodItemToBarcodeCache({ foodName: "X", calories: 1, protein: 1, fat: 1, carbs: 1, weight: -10 }, "b", "vision"), null);
    assert.equal(foodItemToBarcodeCache({ foodName: "X", calories: 1, protein: 1, fat: 1, carbs: 1, weight: NaN }, "b", "vision"), null);
  });
});

describe("decodeBarcodeFromImage", () => {
  test("decodes a generated EAN-13 barcode", async () => {
    const code = "4600682000037";
    const { writeBarcode } = await import("zxing-wasm/writer");
    const written = await writeBarcode(code, { format: "EAN-13" });
    assert.ok(written.image, "writer should produce an image");
    const png = Buffer.from(await written.image!.arrayBuffer());

    const decoded = await decodeBarcodeFromImage(png);
    assert.equal(decoded, code);
  });

  test("returns null for an image without a barcode", async () => {
    // A tiny solid-white PNG (1x1) — no barcode present.
    const blankPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const decoded = await decodeBarcodeFromImage(blankPng);
    assert.equal(decoded, null);
  });
});
