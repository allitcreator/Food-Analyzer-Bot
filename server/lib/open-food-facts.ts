/**
 * Поиск продукта по штрихкоду в Open Food Facts. Вынесен из server/bot.ts,
 * чтобы им пользовались и бот, и Mini App (через lib/barcode-pipeline.ts).
 */
import type { FoodItem } from "../openai";
import { classifyHydratingProduct } from "../barcode";
import { parseServingSize } from "./serving-size";
import { describeError } from "./safe-log";

// Result of an Open Food Facts lookup:
//  - a full FoodItem when OFF has the product WITH nutrition data;
//  - a name-only marker (foundInDb:false) when OFF knows the product name but
//    has no nutrients — the name is then forwarded to vision as a hint;
//  - null when OFF does not know the barcode at all.
export type BarcodeLookupResult =
  | (FoodItem & { barcode: string; foundInDb: true })
  | { foundInDb: false; productName: string };

/** Пределы позиции — те же, что в analyzedItemSchema (shared/routes.ts). */
const MAX_NAME = 200;
const MAX_CALORIES = 10000;
const MAX_MACRO = 5000;
const MAX_WEIGHT = 5000;

/** Число из OFF (там бывают и строки) или NaN. null/undefined/"" → NaN. */
function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

function finiteOr0(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

/** Конечное число в [0, max]; неконечное → 0. */
function clamp(v: number, max: number): number {
  return Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0;
}

/**
 * Разобрать ответ OFF (`/api/v0/product/<code>.json`). Чистая функция, без сети.
 * Ответ OFF — внешние данные, поэтому название обрезаем, а числа проверяем на
 * конечность и укладываем в пределы analyzedItemSchema: позиция уходит клиенту
 * Mini App и в общий кэш barcode_products. Неконечные калории или вес —
 * считаем, что данных о питании нет (промах с названием).
 */
export function parseOffProduct(data: unknown, barcode: string): BarcodeLookupResult | null {
  const d = data as any;
  if (!d || d.status !== 1 || !d.product || typeof d.product !== "object") return null;

  const p = d.product;
  const rawName = [p.product_name_ru, p.product_name, p.generic_name_ru, p.generic_name]
    .find((v) => typeof v === "string" && v.trim() !== "") as string | undefined;
  if (!rawName) return null;
  const name = rawName.trim().slice(0, MAX_NAME);

  const n = p.nutriments && typeof p.nutriments === "object" ? p.nutriments : {};
  // OFF knows the product name but carries no nutrition facts → return the
  // name only, so the caller can hint vision instead of guessing blindly.
  const hasEnergy = n["energy-kcal_100g"] != null || n["energy_100g"] != null;
  const hasMacros = n["proteins_100g"] != null || n["fat_100g"] != null || n["carbohydrates_100g"] != null;
  if (!hasEnergy && !hasMacros) {
    return { foundInDb: false, productName: name };
  }

  // Ккал напрямую, иначе из кДж (нулевое значение — как отсутствующее). Поле
  // энергии есть, но не число («abc», «1e999») — данных о питании нет.
  const kcal = num(n["energy-kcal_100g"]);
  const kj = num(n["energy_100g"]);
  let cal100 = 0;
  if (Number.isFinite(kcal) && kcal !== 0) cal100 = kcal;
  else if (Number.isFinite(kj) && kj !== 0) cal100 = kj / 4.184;
  else if ((n["energy-kcal_100g"] != null && !Number.isFinite(kcal)) || (n["energy_100g"] != null && !Number.isFinite(kj))) {
    return { foundInDb: false, productName: name };
  }
  // БЖУ: нечисловое → 0, отрицательное и огромное обрежет clamp ниже.
  const protein100 = finiteOr0(num(n["proteins_100g"]));
  const fat100 = finiteOr0(num(n["fat_100g"]));
  const carbs100 = finiteOr0(num(n["carbohydrates_100g"]));

  // «0,5 l» → 500, «1 portion (40 g)» → 40; нераспознанное → 100 (lib/serving-size.ts).
  const serving = parseServingSize(typeof p.serving_size === "string" ? p.serving_size : undefined);
  const ratio = serving / 100;
  const calories = Math.round(cal100) * ratio;
  // Вес из parseServingSize всегда конечен, но проверка дешёвая.
  if (!Number.isFinite(calories) || !Number.isFinite(serving)) {
    return { foundInDb: false, productName: name };
  }

  // Classify plain water / unsweetened tea-coffee → goes into water tracking.
  const hydrating = classifyHydratingProduct({
    categoriesTags: Array.isArray(p.categories_tags) ? p.categories_tags : undefined,
    energyKcal100g: n["energy-kcal_100g"] != null ? kcal : Math.round(cal100),
    sugars100g: n["sugars_100g"] != null ? num(n["sugars_100g"]) : null,
  });

  return {
    foodName: name,
    calories: clamp(Math.round(calories), MAX_CALORIES),
    protein: clamp(Math.round(Math.round(protein100) * ratio), MAX_MACRO),
    fat: clamp(Math.round(Math.round(fat100) * ratio), MAX_MACRO),
    carbs: clamp(Math.round(Math.round(carbs100) * ratio), MAX_MACRO),
    weight: clamp(serving, MAX_WEIGHT),
    mealType: "snack",
    hydrating,
    barcode,
    foundInDb: true as const,
  };
}

export async function lookupBarcodeProduct(barcode: string): Promise<BarcodeLookupResult | null> {
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return parseOffProduct(await res.json(), barcode);
  } catch (err) {
    console.error("Open Food Facts lookup error:", describeError(err));
    return null;
  }
}
