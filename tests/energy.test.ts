/**
 * Энергобаланс: расчёт и его текстовое представление.
 *
 * До выноса `buildEnergyBalanceText` жил приватно в `bot.ts`, а рядом лежала
 * дословная копия расчётов BMR/TDEE — два места, которые обязаны были
 * расходиться при первой же правке. Теперь всё в одном модуле и под тестом.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { calculateBMR, calculateTDEE, buildEnergyBalanceText } from "../server/lib/energy";

const profile = { weight: 80, height: 180, age: 30, gender: "male", activityLevel: "moderate" };

describe("buildEnergyBalanceText", () => {
  test("дефицит: полный вид со всеми строками", () => {
    const tdee = calculateTDEE(profile)!;
    const text = buildEnergyBalanceText(profile, tdee - 500);
    assert.match(text, /Энергобаланс/);
    assert.match(text, /Съедено: /);
    assert.match(text, /Расход по профилю: /);
    assert.match(text, /✅ Дефицит: 500 ккал/);
  });

  test("профицит показывается со знаком плюс", () => {
    const tdee = calculateTDEE(profile)!;
    assert.match(buildEnergyBalanceText(profile, tdee + 300), /🚨 Профицит: \+300 ккал/);
  });

  test("ровный ноль — это баланс, а не дефицит", () => {
    const tdee = calculateTDEE(profile)!;
    const text = buildEnergyBalanceText(profile, tdee);
    assert.match(text, /⚖️ Баланс: 0 ккал/);
    assert.equal(text.includes("Дефицит"), false);
  });

  test("компактный вид — одна строка для дневной сводки", () => {
    const tdee = calculateTDEE(profile)!;
    const text = buildEnergyBalanceText(profile, tdee - 200, true);
    assert.equal(text.split("\n").filter((l) => l.trim()).length, 1);
    assert.match(text, /✅ Дефицит: 200 ккал/);
    assert.equal(text.includes("Расход по профилю"), false);
  });

  test("неполный профиль — пустая строка, а не «0 ккал»", () => {
    // Без веса TDEE не посчитать; показывать нули было бы враньём.
    assert.equal(buildEnergyBalanceText({ ...profile, weight: null }, 2000), "");
    assert.equal(calculateBMR({ ...profile, weight: null }), null);
  });
});
