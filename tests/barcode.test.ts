/**
 * Tests for deterministic barcode decoding.
 *   - isValidEanChecksum: pure check-digit validation.
 *   - decodeBarcodeFromImage: round-trip through zxing-wasm writer → reader.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decodeBarcodeFromImage, isValidEanChecksum, classifyHydratingProduct } from "../server/barcode";

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
