/**
 * Deterministic barcode decoding from photos.
 *
 * Uses the zxing-wasm reader to actually decode EAN/UPC barcodes from image
 * pixels instead of asking a vision model to "read" the digits (which
 * hallucinates and yields wrong products from Open Food Facts).
 *
 * zxing-wasm is ESM-only while the server is bundled to CJS by esbuild, so the
 * import MUST stay dynamic (`await import(...)`) and the package MUST remain
 * external (do NOT add it to the allowlist in scripts/build.ts).
 */

import { describeError } from "./lib/safe-log";

/**
 * Потолок пикселей для декодирования: zxing разворачивает картинку в память
 * целиком (~1 байт на пиксель в оттенках серого, плюс RGBA при чтении), и
 * маленький файл с огромными размерами в заголовке («декомпрессионная бомба»)
 * съел бы память процесса. Фото Telegram ≤ 2560×2560 (6,5 Мп) проходят.
 */
export const MAX_DECODE_PIXELS = 16_000_000;

/**
 * Размеры картинки из заголовка, без декодирования: PNG (IHDR), JPEG (SOFn),
 * WebP (VP8 / VP8L / VP8X). Неизвестный формат или обрезанный заголовок → null.
 */
export function readImageSize(buf: Buffer): { width: number; height: number } | null {
  // PNG: сигнатура 8 байт, первым идёт чанк IHDR — ширина и высота uint32 BE.
  if (
    buf.length >= 24 &&
    buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a &&
    buf.toString("latin1", 12, 16) === "IHDR"
  ) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // JPEG: идём по сегментам до SOFn (C0–CF, кроме DHT C4, JPG C8 и DAC CC).
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 4 <= buf.length) {
      if (buf[off] !== 0xff) return null;
      const marker = buf[off + 1];
      // Заполняющие 0xFF и маркеры без длины (RSTn, TEM) пропускаем.
      if (marker === 0xff) { off++; continue; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
      // SOS/EOI до SOF — размеров не нашли.
      if (marker === 0xda || marker === 0xd9) return null;
      const len = buf.readUInt16BE(off + 2);
      if (len < 2) return null;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (off + 9 > buf.length) return null;
        return { width: buf.readUInt16BE(off + 7), height: buf.readUInt16BE(off + 5) };
      }
      off += 2 + len;
    }
    return null;
  }

  // WebP: RIFF....WEBP + первый чанк.
  if (buf.length >= 16 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") {
    const chunk = buf.toString("latin1", 12, 16);
    if (chunk === "VP8X" && buf.length >= 30) {
      return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    }
    if (chunk === "VP8 " && buf.length >= 30) {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === "VP8L" && buf.length >= 25) {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    return null;
  }

  return null;
}

/** Читатель штрихкодов: по умолчанию zxing-wasm, тесты подставляют свой. */
export type BarcodeReader = (image: Buffer) => Promise<Array<{ text: string }>>;

const zxingReader: BarcodeReader = async (image) => {
  const { readBarcodes } = await import("zxing-wasm/reader");
  return readBarcodes(image, {
    formats: ["EAN-13", "EAN-8", "UPC-A", "UPC-E"],
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
  });
};

/**
 * Decode the first EAN-13 / EAN-8 / UPC-A / UPC-E barcode found in an image.
 * Returns the numeric code, or null if none is found / on any error.
 *
 * До декодирования проверяем размеры из заголовка: неизвестный формат или
 * больше MAX_DECODE_PIXELS — сразу null, без ошибки (вызывающий уйдёт в vision).
 */
export async function decodeBarcodeFromImage(imageBuffer: Buffer, read: BarcodeReader = zxingReader): Promise<string | null> {
  const size = readImageSize(imageBuffer);
  if (!size || size.width <= 0 || size.height <= 0 || size.width * size.height > MAX_DECODE_PIXELS) {
    return null;
  }
  try {
    const results = await read(imageBuffer);
    for (const result of results) {
      if (result.text && result.text.trim()) return result.text;
    }
    return null;
  } catch (error) {
    console.error("Barcode Decode Error:", describeError(error));
    return null;
  }
}

/**
 * Decide whether an Open Food Facts product counts as a "hydrating" drink,
 * i.e. one that should be logged into water tracking (water_logs) rather than
 * into the food diary.
 *
 * A product is hydrating when either:
 *   - its category tags mark it as water (still / spring / mineral water), OR
 *   - it is a beverage (en:beverages) that is essentially calorie- and
 *     sugar-free (≈ plain water, unsweetened tea/coffee): energy ≤ 5 kcal/100g
 *     and sugars ≈ 0.
 *
 * Sweet/caloric drinks (juice, soda, milk, beer, sweet tea…) are NOT hydrating.
 * Pure function — no network — so it is unit-testable in isolation.
 */
const WATER_CATEGORY_TAGS = ["en:waters", "en:spring-waters", "en:mineral-waters"];

export function classifyHydratingProduct(input: {
  categoriesTags?: string[] | null;
  energyKcal100g?: number | null;
  sugars100g?: number | null;
}): boolean {
  const tags = (input.categoriesTags ?? []).map((t) => String(t).toLowerCase());

  // Explicit water categories are always hydrating.
  if (tags.some((t) => WATER_CATEGORY_TAGS.includes(t))) return true;

  // Generic beverage with ~0 kcal and ~0 sugar → unsweetened tea/coffee/water.
  if (tags.includes("en:beverages")) {
    const kcal = input.energyKcal100g;
    const sugars = input.sugars100g;
    // Require energy to be a known low value; sugars must be absent or ~0.
    if (typeof kcal === "number" && kcal <= 5 && (sugars == null || sugars <= 0.5)) {
      return true;
    }
  }

  return false;
}

/**
 * Shape of a row in the global `barcode_products` cache, restricted to the
 * fields the pure recompute helpers need (per-100 nutrition + serving).
 */
export interface BarcodeCacheRecord {
  barcode: string;
  foodName: string;
  caloriesPer100: number;
  proteinPer100: number;
  fatPer100: number;
  carbsPer100: number;
  defaultWeight: number;
  hydrating: boolean;
  source: string;
}

/** FoodItem-compatible result of a barcode lookup (mirrors lookupBarcodeProduct). */
export interface BarcodeFoodItem {
  foodName: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  weight: number;
  mealType: string;
  hydrating: boolean;
  barcode: string;
  foundInDb: boolean;
}

/**
 * Map a cached barcode record → FoodItem-shaped object, recomputing КБЖУ from
 * the stored per-100 values onto a serving weight (defaults to the cached
 * `defaultWeight`). Output matches what lookupBarcodeProduct returns so the
 * photo flow can treat cache hits and OFF hits identically.
 * Pure — no network / DB — so it is unit-testable in isolation.
 */
export function barcodeCacheToFoodItem(
  rec: BarcodeCacheRecord,
  weight?: number,
): BarcodeFoodItem {
  const w = weight != null && weight > 0 ? weight : rec.defaultWeight;
  const ratio = w / 100;
  return {
    foodName: rec.foodName,
    calories: Math.round(rec.caloriesPer100 * ratio),
    protein: Math.round(rec.proteinPer100 * ratio),
    fat: Math.round(rec.fatPer100 * ratio),
    carbs: Math.round(rec.carbsPer100 * ratio),
    weight: Math.round(w),
    mealType: "snack",
    hydrating: rec.hydrating,
    barcode: rec.barcode,
    foundInDb: true,
  };
}

/**
 * Build a cache record from a (possibly user-corrected) food card, normalizing
 * КБЖУ to per-100 values: per100 = value / weight * 100. The card's weight
 * becomes the cached `defaultWeight`. Returns null if weight ≤ 0 (cannot
 * normalize). Pure — no network / DB.
 */
export function foodItemToBarcodeCache(
  item: {
    foodName: string;
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
    weight: number;
    hydrating?: boolean;
  },
  barcode: string,
  source: string,
): BarcodeCacheRecord | null {
  const weight = Number(item.weight);
  if (!Number.isFinite(weight) || weight <= 0) return null;
  const factor = 100 / weight;
  const per100 = (v: number) => Math.round((Number(v) || 0) * factor * 10) / 10;
  return {
    barcode,
    foodName: item.foodName,
    caloriesPer100: per100(item.calories),
    proteinPer100: per100(item.protein),
    fatPer100: per100(item.fat),
    carbsPer100: per100(item.carbs),
    defaultWeight: Math.round(weight),
    hydrating: item.hydrating === true,
    source,
  };
}

/**
 * Validate the check digit of an EAN-13 / EAN-8 / UPC-A (12-digit) code.
 * Uses the standard GTIN algorithm: from the rightmost data digit, weights
 * alternate 3, 1, 3, 1, … and the check digit closes the sum to a multiple of 10.
 */
export function isValidEanChecksum(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  if (code.length !== 8 && code.length !== 12 && code.length !== 13) return false;

  const digits = code.split("").map(Number);
  const check = digits[digits.length - 1];

  let sum = 0;
  for (let i = digits.length - 2, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += digits[i] * weight;
  }
  const computed = (10 - (sum % 10)) % 10;

  return computed === check;
}
