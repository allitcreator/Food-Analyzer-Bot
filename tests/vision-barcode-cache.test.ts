/**
 * Общий кэш штрихкодов из vision: что из подтверждённой карточки можно
 * отдать всем пользователям, сканирующим этот же штрихкод.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  tagVisionBarcode,
  markUserEdited,
  shouldCacheVisionBarcode,
} from "../server/lib/vision-barcode-cache";

const EAN = "4600682000037";

function visionItem(extra: Record<string, unknown> = {}) {
  return { foodName: "Йогурт", calories: 120, protein: 5, fat: 3, carbs: 18, weight: 150, mealType: "snack", ...extra };
}

describe("tagVisionBarcode", () => {
  test("одна позиция — получает штрихкод и пометку vision", () => {
    const items = [visionItem()];
    tagVisionBarcode(items, EAN);
    assert.equal((items[0] as any).barcode, EAN);
    assert.equal((items[0] as any).barcodeSource, "vision");
  });

  test("несколько позиций — штрихкод не ставится никому", () => {
    const items = [visionItem(), visionItem()];
    tagVisionBarcode(items, EAN);
    assert.ok(items.every((i) => (i as any).barcode === undefined));
  });

  test("без штрихкода ничего не меняется", () => {
    const items = [visionItem()];
    tagVisionBarcode(items, null);
    assert.equal((items[0] as any).barcodeSource, undefined);
  });
});

describe("shouldCacheVisionBarcode", () => {
  test("неизменённый ответ vision с одной позицией кэшируется", () => {
    const [item] = tagVisionBarcode([visionItem()], EAN);
    assert.equal(shouldCacheVisionBarcode(item), true);
  });

  test("после правки пользователем — не кэшируется", () => {
    const [item] = tagVisionBarcode([visionItem()], EAN);
    markUserEdited(item);
    assert.equal(shouldCacheVisionBarcode(item), false);
  });

  test("карточка без пометки vision (OFF, кэш, текст) не кэшируется", () => {
    assert.equal(shouldCacheVisionBarcode(visionItem({ barcode: EAN })), false);
    assert.equal(shouldCacheVisionBarcode(visionItem()), false);
    assert.equal(shouldCacheVisionBarcode(undefined), false);
  });

  test("пометка vision без штрихкода не кэшируется", () => {
    assert.equal(shouldCacheVisionBarcode(visionItem({ barcodeSource: "vision" })), false);
  });
});
