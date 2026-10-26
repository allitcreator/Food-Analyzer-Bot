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
  readImageSize,
  MAX_DECODE_PIXELS,
} from "../server/barcode";
import { parseOffProduct } from "../server/lib/open-food-facts";
import { analyzedItemSchema } from "../shared/routes";

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

// ─── Размер картинки до декодирования (защита от декомпрессионной бомбы) ─────

/** Заголовок PNG: сигнатура + IHDR с заданными размерами, без пикселей. */
function pngHeader(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

/** JPEG: SOI, сегмент APP0 и SOFn с заданными размерами. */
function jpegHeader(width: number, height: number, sof = 0xc0): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from("JFIF\0", "latin1"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sofSeg = Buffer.alloc(19);
  sofSeg[0] = 0xff;
  sofSeg[1] = sof;
  sofSeg.writeUInt16BE(17, 2);
  sofSeg[4] = 8;
  sofSeg.writeUInt16BE(height, 5);
  sofSeg.writeUInt16BE(width, 7);
  sofSeg[9] = 3;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sofSeg]);
}

/** WebP с чанком VP8X (24-битные ширина-1 и высота-1). */
function webpVp8x(width: number, height: number): Buffer {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "latin1");
  b.writeUInt32LE(22, 4);
  b.write("WEBP", 8, "latin1");
  b.write("VP8X", 12, "latin1");
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}

describe("readImageSize", () => {
  test("PNG: размеры из IHDR", () => {
    assert.deepEqual(readImageSize(pngHeader(20000, 20000)), { width: 20000, height: 20000 });
  });

  test("JPEG: размеры из SOF0 и SOF2 после других сегментов", () => {
    assert.deepEqual(readImageSize(jpegHeader(2560, 1920)), { width: 2560, height: 1920 });
    assert.deepEqual(readImageSize(jpegHeader(640, 480, 0xc2)), { width: 640, height: 480 });
  });

  test("WebP VP8X", () => {
    assert.deepEqual(readImageSize(webpVp8x(5000, 4000)), { width: 5000, height: 4000 });
  });

  test("неизвестный формат и обрезанный заголовок → null", () => {
    assert.equal(readImageSize(Buffer.from("GIF89a....")), null);
    assert.equal(readImageSize(Buffer.alloc(0)), null);
    assert.equal(readImageSize(pngHeader(10, 10).subarray(0, 20)), null);
    assert.equal(readImageSize(jpegHeader(10, 10).subarray(0, 25)), null);
  });
});

describe("decodeBarcodeFromImage: лимит размера", () => {
  test("PNG 20000×20000 → null, декодер не вызывается", async () => {
    let calls = 0;
    const r = await decodeBarcodeFromImage(pngHeader(20000, 20000), async () => {
      calls++;
      return [{ text: "4600682000037" }];
    });
    assert.equal(r, null);
    assert.equal(calls, 0);
  });

  test("неизвестный формат → null, декодер не вызывается", async () => {
    let calls = 0;
    const r = await decodeBarcodeFromImage(Buffer.from("GIF89a-какие-то-байты"), async () => {
      calls++;
      return [{ text: "4600682000037" }];
    });
    assert.equal(r, null);
    assert.equal(calls, 0);
  });

  test("картинка в пределах лимита уходит в декодер", async () => {
    assert.ok(2560 * 2560 <= MAX_DECODE_PIXELS, "фото Telegram должны проходить");
    let calls = 0;
    const r = await decodeBarcodeFromImage(jpegHeader(2560, 2560), async () => {
      calls++;
      return [{ text: "4600682000037" }];
    });
    assert.equal(r, "4600682000037");
    assert.equal(calls, 1);
  });
});

// ─── Ответ Open Food Facts → позиция ─────────────────────────────────────────

describe("parseOffProduct", () => {
  const EAN = "4600682000037";
  function off(product: Record<string, unknown>) {
    return { status: 1, product };
  }
  /** Поля, которые проверяет analyzedItemSchema. */
  function asItem(r: any) {
    const { foodName, calories, protein, fat, carbs, weight } = r;
    return analyzedItemSchema.parse({ foodName, calories, protein, fat, carbs, weight, mealType: "snack" });
  }

  test("обычный продукт", () => {
    const r = parseOffProduct(off({ product_name: "Кефир", serving_size: "200 g", nutriments: { "energy-kcal_100g": 50, proteins_100g: 3, fat_100g: 2.5, carbohydrates_100g: 4 } }), EAN);
    assert.ok(r && r.foundInDb);
    assert.equal(r.calories, 100);
    assert.equal(r.weight, 200);
    asItem(r);
  });

  test("длинное название обрезается до 200 символов", () => {
    const r = parseOffProduct(off({ product_name: "я".repeat(500), nutriments: { "energy-kcal_100g": 50 } }), EAN);
    assert.ok(r && r.foundInDb);
    assert.equal(r.foodName.length, 200);
    asItem(r);
  });

  test("огромные и отрицательные числа укладываются в пределы схемы", () => {
    const r = parseOffProduct(off({
      product_name: "Странное",
      serving_size: "100000 g",
      nutriments: { "energy-kcal_100g": 1e9, proteins_100g: -5, fat_100g: 1e7, carbohydrates_100g: "1e6" },
    }), EAN);
    assert.ok(r && r.foundInDb);
    assert.equal(r.calories, 10000);
    assert.equal(r.protein, 0);
    assert.equal(r.fat, 5000);
    assert.equal(r.carbs, 5000);
    assert.equal(r.weight, 5000);
    asItem(r);
  });

  test("нечисловой БЖУ → 0", () => {
    const r = parseOffProduct(off({ product_name: "Хлеб", nutriments: { "energy-kcal_100g": 250, proteins_100g: "много", fat_100g: null } }), EAN);
    assert.ok(r && r.foundInDb);
    assert.equal(r.protein, 0);
    assert.equal(r.fat, 0);
    asItem(r);
  });

  test("неконечные калории → промах с названием", () => {
    for (const kcal of ["abc", "1e999"]) {
      const r = parseOffProduct(off({ product_name: "Сок", nutriments: { "energy-kcal_100g": kcal } }), EAN);
      assert.deepEqual(r, { foundInDb: false, productName: "Сок" }, String(kcal));
    }
  });

  test("название в промахе тоже обрезается", () => {
    const r = parseOffProduct(off({ product_name: "x".repeat(300) }), EAN);
    assert.deepEqual(r, { foundInDb: false, productName: "x".repeat(200) });
  });

  test("нет продукта или названия → null", () => {
    assert.equal(parseOffProduct({ status: 0 }, EAN), null);
    assert.equal(parseOffProduct(off({ nutriments: { "energy-kcal_100g": 50 } }), EAN), null);
    assert.equal(parseOffProduct(off({ product_name: 42 }), EAN), null);
    assert.equal(parseOffProduct(null, EAN), null);
  });
});
