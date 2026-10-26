/**
 * Разбор serving_size из Open Food Facts в граммы/миллилитры порции.
 * Раньше брали первое целое число: «0,5 l» → 0 (карточка «0 ккал»),
 * «1.5 L» → 1, «1 portion (40 g)» → 1.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseServingSize, DEFAULT_SERVING } from "../server/lib/serving-size";

describe("parseServingSize", () => {
  const cases: Array<[string | null | undefined, number]> = [
    ["250 ml", 250],
    ["250ml", 250],
    ["330 мл", 330],
    ["0,5 l", 500],
    ["0.5 L", 500],
    ["1.5 L", 1500],
    ["1,5 л", 1500],
    ["0,33 l", 330],
    ["33 cl", 330],
    ["30 g (2 pieces)", 30],
    ["30g", 30],
    ["1 portion (40 g)", 40],
    ["2 biscuits (25 g)", 25],
    ["100 г", 100],
    ["50 гр", 50],
    ["12.5 g", 13],
    ["1 kg", 1000],
    ["1 oz (28 g)", 28],
    ["8 fl oz (240 ml)", 240],
    ["100", 100],
    ["1 oz", DEFAULT_SERVING],
    ["2 pieces", DEFAULT_SERVING],
    ["500 mg", DEFAULT_SERVING],
    ["0 g", DEFAULT_SERVING],
    ["0", DEFAULT_SERVING],
    ["", DEFAULT_SERVING],
    [null, DEFAULT_SERVING],
    [undefined, DEFAULT_SERVING],
    ["portion", DEFAULT_SERVING],
  ];
  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} → ${expected}`, () => {
      assert.equal(parseServingSize(input), expected);
    });
  }
  test("fallback = 100", () => {
    assert.equal(DEFAULT_SERVING, 100);
  });
});
