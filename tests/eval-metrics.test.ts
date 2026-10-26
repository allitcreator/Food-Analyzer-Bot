/**
 * Метрики eval-скрипта (scripts/eval-models.ts): сопоставление позиций по
 * названию, попадание в диапазон, MAPE/MAE, CER, перцентили. Сам eval ходит в
 * OpenRouter и в npm test не входит, а метрики — чистые функции, их проверяем.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeName,
  nameSimilarity,
  matchItems,
  precisionRecall,
  inRange,
  midpoint,
  absPctError,
  mean,
  percentile,
  cer,
  markdownTable,
  scoreFoodItems,
} from "../scripts/eval/metrics";

describe("normalizeName / nameSimilarity", () => {
  test("регистр, ё, пунктуация и проценты не мешают", () => {
    assert.equal(normalizeName("Творог 5%, Простоквашино!"), "творог 5 простоквашино");
    assert.equal(normalizeName("Зелёный  чай"), "зеленый чай");
  });

  test("формы слова совпадают", () => {
    assert.ok(nameSimilarity("яйцо", "Яйца куриные варёные") >= 0.5);
    assert.ok(nameSimilarity("гречка", "Гречку") >= 0.5);
    assert.ok(nameSimilarity("котлета", "Котлеты мясные") >= 0.5);
    assert.equal(nameSimilarity("банан", "банан"), 1);
  });

  test("разные продукты не совпадают", () => {
    assert.ok(nameSimilarity("банан", "яблоко") < 0.5);
    assert.ok(nameSimilarity("кефир", "кофе с молоком") < 0.5);
    assert.ok(nameSimilarity("хлеб", "котлета") < 0.5);
  });
});

describe("matchItems", () => {
  const expected = [
    { name: "яйцо", aliases: ["яйца"] },
    { name: "хлеб", aliases: ["хлеб белый"] },
  ];

  test("порядок не важен, лишняя позиция остаётся без пары", () => {
    const m = matchItems(expected, ["Хлеб пшеничный", "Яйца варёные", "Масло сливочное"]);
    assert.deepEqual(m.pairs.map((p) => [p.expected, p.actual]), [[0, 1], [1, 0]].sort((a, b) => a[0] - b[0]));
    assert.deepEqual(m.unmatchedActual, [2]);
    assert.deepEqual(m.unmatchedExpected, []);
  });

  test("каждая фактическая позиция используется один раз", () => {
    const m = matchItems([{ name: "котлета" }, { name: "котлета" }], ["котлета"]);
    assert.equal(m.pairs.length, 1);
    assert.deepEqual(m.unmatchedExpected, [1]);
  });

  test("синоним из aliases засчитывается", () => {
    const m = matchItems([{ name: "минеральная вода", aliases: ["минералка"] }], ["Минералка"]);
    assert.equal(m.pairs.length, 1);
  });
});

describe("precisionRecall", () => {
  test("обычный случай", () => {
    assert.deepEqual(precisionRecall(2, 3, 4), { precision: 0.5, recall: 2 / 3 });
  });
  test("пусто и там и там — идеально", () => {
    assert.deepEqual(precisionRecall(0, 0, 0), { precision: 1, recall: 1 });
  });
  test("модель ничего не вернула при непустом эталоне", () => {
    assert.deepEqual(precisionRecall(0, 2, 0), { precision: 1, recall: 0 });
  });
});

describe("диапазоны и ошибки", () => {
  test("inRange включает границы", () => {
    assert.equal(inRange(10, [10, 20]), true);
    assert.equal(inRange(20, [10, 20]), true);
    assert.equal(inRange(20.1, [10, 20]), false);
    assert.equal(inRange(NaN, [10, 20]), false);
  });

  test("absPctError считается от середины диапазона, ноль в эталоне — null", () => {
    assert.equal(midpoint([80, 120]), 100);
    assert.equal(absPctError(110, [80, 120]), 0.1);
    assert.equal(absPctError(90, [80, 120]), 0.1);
    assert.equal(absPctError(5, [0, 0]), null);
  });

  test("mean и percentile", () => {
    assert.equal(mean([]), null);
    assert.equal(mean([1, 2, 3]), 2);
    assert.equal(percentile([], 50), null);
    assert.equal(percentile([5], 95), 5);
    assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5.5);
    assert.equal(percentile([10, 1, 5], 100), 10);
  });
});

describe("cer", () => {
  test("совпадение без учёта регистра, ё и пунктуации", () => {
    assert.equal(cer("Съел два яйца, выпил чай.", "съел два яйца выпил чай"), 0);
    assert.equal(cer("ёлка", "елка"), 0);
  });

  test("одна замена на 4 символа — 0.25", () => {
    assert.equal(cer("кефр", "кефи"), 0.25);
  });

  test("пустая гипотеза — 1, пустой эталон и пустая гипотеза — 0", () => {
    assert.equal(cer("банан", ""), 1);
    assert.equal(cer("", ""), 0);
  });
});

describe("markdownTable", () => {
  test("шапка, разделитель и экранирование вертикальной черты", () => {
    const out = markdownTable(["a", "b"], [["1", "x|y"]]);
    assert.equal(out, "| a | b |\n| --- | --- |\n| 1 | x\\|y |");
  });
});

describe("scoreFoodItems", () => {
  const expected = [
    { name: "яйцо", calories: [150, 190] as [number, number], protein: [12, 16] as [number, number], fat: [10, 14] as [number, number], carbs: [0, 2] as [number, number] },
    { name: "вода", calories: [0, 5] as [number, number], protein: [0, 0.5] as [number, number], fat: [0, 0.5] as [number, number], carbs: [0, 0.5] as [number, number], hydrating: true, mealType: "lunch" },
  ];

  test("сопоставленные позиции, диапазоны, hydrating, mealType и сумма калорий", () => {
    const s = scoreFoodItems(expected, [
      { foodName: "Вода питьевая", calories: 0, protein: 0, fat: 0, carbs: 0, hydrating: true, mealType: "dinner" },
      { foodName: "Яйца варёные", calories: 200, protein: 14, fat: 12, carbs: 1 },
    ]);
    assert.equal(s.matched, 2);
    assert.deepEqual(s.kcalApe, [0.176470588]); // |200-170|/170, вода без процента
    assert.deepEqual(s.kcalInRange, [false, true]);
    assert.deepEqual(s.macroAbsErr.protein, [0, 0.25]);
    assert.equal(s.macroInRange.every(Boolean), true);
    assert.deepEqual(s.hydratingHits, [true, true]);
    assert.deepEqual(s.mealTypeHits, [false]);
    assert.ok(Math.abs((s.totalKcalApe ?? 0) - (200 - 172.5) / 172.5) < 1e-9);
  });

  test("эталон из одной воды — сумма калорий не оценивается", () => {
    const s = scoreFoodItems([expected[1]], [{ foodName: "вода", calories: 0, protein: 0, fat: 0, carbs: 0, hydrating: true }]);
    assert.equal(s.totalKcalApe, null);
  });
});
