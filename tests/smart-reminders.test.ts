/**
 * Юнит-тесты чистой логики умных напоминаний: медиана времени приёмов по
 * истории (в таймзоне пользователя), правило «пора напомнить» с окном, и
 * форматирование минут в "HH:MM". БД и Telegram тут не участвуют.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  typicalMealTimes,
  dueSmartReminder,
  minutesToHHMM,
  type SmartMeal,
} from "../server/lib/smart-reminders";

const NOW = new Date("2026-07-25T09:00:00Z");

describe("typicalMealTimes", () => {
  test("медиана нечётной длины", () => {
    // Три завтрака в 08:00, 08:20, 08:40 (UTC) → медиана 08:20 = 500 мин.
    const logs = [
      { date: new Date("2026-07-20T08:00:00Z"), mealType: "breakfast" },
      { date: new Date("2026-07-21T08:20:00Z"), mealType: "breakfast" },
      { date: new Date("2026-07-22T08:40:00Z"), mealType: "breakfast" },
    ];
    const t = typicalMealTimes(logs, "UTC", NOW);
    assert.equal(t.breakfast?.medianMinutes, 500);
    assert.equal(t.breakfast?.count, 3);
  });

  test("медиана чётной длины = среднее двух центральных", () => {
    // 08:00 и 08:20 (UTC) → среднее (480+500)/2 = 490.
    const logs = [
      { date: new Date("2026-07-20T08:00:00Z"), mealType: "lunch" },
      { date: new Date("2026-07-21T08:20:00Z"), mealType: "lunch" },
    ];
    const t = typicalMealTimes(logs, "UTC", NOW);
    assert.equal(t.lunch?.medianMinutes, 490);
    assert.equal(t.lunch?.count, 2);
  });

  test("snack и незнакомые mealType игнорируются", () => {
    const logs = [
      { date: new Date("2026-07-20T08:00:00Z"), mealType: "snack" },
      { date: new Date("2026-07-20T12:00:00Z"), mealType: "other" },
    ];
    const t = typicalMealTimes(logs, "UTC", NOW);
    assert.deepEqual(t, {});
  });

  test("пустая история → пустой объект", () => {
    assert.deepEqual(typicalMealTimes([], "UTC", NOW), {});
  });

  test("tz-корректность: время считается в таймзоне пользователя", () => {
    // 03:00 UTC → 13:00 во Владивостоке (UTC+10) = 780 мин.
    const logs = [{ date: new Date("2026-07-20T03:00:00Z"), mealType: "breakfast" }];
    const t = typicalMealTimes(logs, "Asia/Vladivostok", NOW);
    assert.equal(t.breakfast?.medianMinutes, 780);
    // Тот же момент в UTC — 03:00 = 180 мин: медиана зависит от tz.
    const utc = typicalMealTimes(logs, "UTC", NOW);
    assert.equal(utc.breakfast?.medianMinutes, 180);
  });

  test("несколько приёмов группируются раздельно", () => {
    const logs = [
      { date: new Date("2026-07-20T08:00:00Z"), mealType: "breakfast" },
      { date: new Date("2026-07-20T13:00:00Z"), mealType: "lunch" },
      { date: new Date("2026-07-20T19:00:00Z"), mealType: "dinner" },
    ];
    const t = typicalMealTimes(logs, "UTC", NOW);
    assert.equal(t.breakfast?.medianMinutes, 480);
    assert.equal(t.lunch?.medianMinutes, 780);
    assert.equal(t.dinner?.medianMinutes, 1140);
  });
});

describe("dueSmartReminder", () => {
  const typical = (m: SmartMeal, medianMinutes: number, count: number) =>
    ({ [m]: { medianMinutes, count } }) as Partial<
      Record<SmartMeal, { medianMinutes: number; count: number }>
    >;

  test("< 5 записей — не напоминаем", () => {
    const t = typical("breakfast", 480, 4);
    assert.equal(dueSmartReminder(t, new Set(), 520), null);
  });

  test("приём уже записан сегодня — не напоминаем", () => {
    const t = typical("breakfast", 480, 10);
    assert.equal(dueSmartReminder(t, new Set(["breakfast"]), 520), null);
  });

  test("до нижней границы окна (median+30) — рано", () => {
    const t = typical("breakfast", 480, 10);
    // lo = 510; 509 < lo → null; 510 → due
    assert.equal(dueSmartReminder(t, new Set(), 509), null);
    assert.equal(dueSmartReminder(t, new Set(), 510), "breakfast");
  });

  test("верхняя граница окна (median+30+120) включительно", () => {
    const t = typical("breakfast", 480, 10);
    // hi = 630; 630 → due; 631 → null
    assert.equal(dueSmartReminder(t, new Set(), 630), "breakfast");
    assert.equal(dueSmartReminder(t, new Set(), 631), null);
  });

  test("порядок: возвращается первый подходящий завтрак → обед", () => {
    const t: Partial<Record<SmartMeal, { medianMinutes: number; count: number }>> = {
      breakfast: { medianMinutes: 480, count: 10 },
      lunch: { medianMinutes: 450, count: 10 },
    };
    // Оба в окне (nowMinutes=520): breakfast lo=510..630, lunch lo=480..600.
    assert.equal(dueSmartReminder(t, new Set(), 520), "breakfast");
    // Завтрак записан → выпадает обед.
    assert.equal(dueSmartReminder(t, new Set(["breakfast"]), 520), "lunch");
  });

  test("пустой typical → null", () => {
    assert.equal(dueSmartReminder({}, new Set(), 600), null);
  });
});

describe("minutesToHHMM", () => {
  test("обычные значения", () => {
    assert.equal(minutesToHHMM(0), "00:00");
    assert.equal(minutesToHHMM(490), "08:10");
    assert.equal(minutesToHHMM(780), "13:00");
    assert.equal(minutesToHHMM(1439), "23:59");
  });

  test("дробь округляется, выход за сутки заворачивается", () => {
    assert.equal(minutesToHHMM(489.6), "08:10");
    assert.equal(minutesToHHMM(1440), "00:00");
    assert.equal(minutesToHHMM(-10), "23:50");
  });
});
