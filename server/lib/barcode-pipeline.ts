/**
 * Поиск штрихкода на фото и продукта по нему — общий для бота и Mini App.
 *
 * Шаги:
 *   1. `findBarcode`: сначала детерминированный zxing по пикселям; если не
 *      нашёл и разрешён AI — vision «читает» цифры, но верим только коду с
 *      правильной контрольной суммой EAN (отсекает галлюцинации).
 *   2. `resolveBarcodeProduct`: общий кэш barcode_products → Open Food Facts
 *      (попадание пишем в кэш). Промах возвращает название из OFF, если оно
 *      есть, — вызывающий передаёт его в vision подсказкой.
 *
 * Сеть, БД и LLM приходят зависимостями, поэтому модуль тестируется без них.
 * Сообщения статуса и кэш подтверждённого vision-результата остаются у
 * вызывающего (бот).
 */
import type { FoodItem } from "../openai";
import { barcodeCacheToFoodItem, foodItemToBarcodeCache, isValidEanChecksum, type BarcodeCacheRecord } from "../barcode";
import type { BarcodeLookupResult } from "./open-food-facts";
import { describeError } from "./safe-log";

export type BarcodeDetectDeps = {
  /** zxing по пикселям (server/barcode.ts `decodeBarcodeFromImage`). */
  decode: (image: Buffer) => Promise<string | null>;
  /** AI-распознавание цифр (server/openai.ts `detectBarcode`). */
  detectAi: (imageBase64: string) => Promise<string | null>;
};

export type BarcodeLookupDeps = {
  /** Open Food Facts (lib/open-food-facts.ts `lookupBarcodeProduct`). */
  lookupOff: (code: string) => Promise<BarcodeLookupResult | null>;
  getCached: (code: string) => Promise<BarcodeCacheRecord | undefined>;
  upsertCached: (rec: BarcodeCacheRecord) => Promise<unknown>;
};

/** Позиция, найденная по штрихкоду (кэш или OFF). mealType у неё — "snack". */
export type BarcodeHit = FoodItem & { hydrating: boolean; barcode: string; foundInDb: boolean };

export type BarcodeProductResult =
  | { found: true; item: BarcodeHit; source: "cache" | "off" }
  | { found: false; productName?: string };

/**
 * Найти штрихкод на фото. `useAi: false` — только zxing (без AI-вызова).
 * Возвращает цифры кода или null.
 */
export async function findBarcode(
  image: Buffer,
  imageBase64: string,
  opts: { useAi: boolean },
  deps: BarcodeDetectDeps,
): Promise<string | null> {
  const decoded = await deps.decode(image);
  if (decoded) return decoded;
  if (!opts.useAi) return null;
  const aiCode = await deps.detectAi(imageBase64);
  return aiCode && isValidEanChecksum(aiCode) ? aiCode : null;
}

/** Продукт по коду: кэш → Open Food Facts (с записью в кэш). */
export async function resolveBarcodeProduct(code: string, deps: BarcodeLookupDeps): Promise<BarcodeProductResult> {
  // 1) Самонаполняемый локальный кэш (общий для всех пользователей).
  const cached = await deps.getCached(code).catch((e) => {
    console.error("Barcode cache read error:", describeError(e));
    return undefined;
  });
  if (cached) {
    console.log("Barcode product found in cache");
    return { found: true, item: barcodeCacheToFoodItem(cached), source: "cache" };
  }

  // 2) Open Food Facts.
  const off = await deps.lookupOff(code);
  if (off && off.foundInDb) {
    console.log("Barcode product found in OFF");
    // Запоминаем попадание, чтобы в следующий раз не ходить в сеть.
    const rec = foodItemToBarcodeCache(off, code, "off");
    if (rec) {
      await deps.upsertCached(rec).catch((e) => console.error("Barcode cache write (off) error:", describeError(e)));
    }
    return { found: true, item: { ...off, hydrating: off.hydrating === true }, source: "off" };
  }

  // 3) Промах: дальше vision, с названием из OFF, если оно известно.
  console.log("Barcode not found in cache/OFF, falling back to vision...");
  return off && off.foundInDb === false ? { found: false, productName: off.productName } : { found: false };
}

/** Подсказка для vision после промаха: код и (если есть) название из OFF. */
export function visionHintForMiss(
  code: string,
  miss: { productName?: string },
): { productName?: string; barcode: string } {
  return miss.productName ? { productName: miss.productName, barcode: code } : { barcode: code };
}
