/**
 * Чистые функции клиента Mini App (client/src/lib): «сегодня» и время суток в
 * таймзоне профиля, тексты ошибок мутаций, валидация веса в «Добавить еду»,
 * цвета столбиков недели, подсказка про белок, эмодзи блюд, сводки «Трендов».
 * Без браузера и DOM.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { todayInTimeZone, minutesInTimeZone } from "../client/src/lib/date-tz";
import { weekBarTone, weekBarHeight } from "../client/src/lib/week-bars";
import { proteinTip } from "../client/src/lib/protein-tip";
import { foodEmoji } from "../client/src/lib/food-emoji";
import {
  averageCalories,
  averageMacros,
  calorieExtremes,
  withoutDay,
} from "../client/src/lib/stats-summary";
import { weightTrend } from "../client/src/lib/weight-trend";
import {
  formatDayTitle,
  formatDateLong,
  formatDateRange,
  formatDayMonthShort,
  weekdayShort,
} from "../client/src/lib/format";
import { mealTypeByMinutes, mealTypeByTime } from "../shared/meal-time";
import { pickAudioMimeType, AUDIO_MIME_CANDIDATES } from "../client/src/lib/voice";
import { describeError } from "../client/src/lib/errors";
import { ApiError } from "../client/src/lib/api";
import { isValidFoodWeight } from "../client/src/lib/food-weight";

describe("todayInTimeZone", () => {
  const now = new Date("2026-10-26T22:30:00Z");

  test("uses the profile timezone, not the device clock", () => {
    assert.equal(todayInTimeZone("Europe/Moscow", now), "2026-10-27");
    assert.equal(todayInTimeZone("Asia/Vladivostok", now), "2026-10-27");
    assert.equal(todayInTimeZone("America/New_York", now), "2026-10-26");
  });

  test("null/empty timezone falls back to Europe/Moscow like the server", () => {
    assert.equal(todayInTimeZone(null, now), "2026-10-27");
    assert.equal(todayInTimeZone("", now), "2026-10-27");
  });

  test("invalid timezone does not throw", () => {
    assert.match(todayInTimeZone("Mars/Base", now), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("describeError", () => {
  test("network / timeout / rate limit / validation / fallback", () => {
    assert.match(describeError(new ApiError(0, "timeout"), "Не удалось сохранить"), /не ответил/);
    assert.match(describeError(new ApiError(0, "network"), "Не удалось сохранить"), /соединени/);
    assert.match(describeError(new TypeError("Failed to fetch"), "Не удалось сохранить"), /соединени/);
    // Дневная AI-квота и занятое перекодирование голоса — свои тексты.
    assert.match(describeError(new ApiError(429, "quota_exceeded"), "Ошибка анализа"), /лимит/i);
    assert.match(describeError(new ApiError(503, "busy"), "Ошибка анализа"), /занят/i);
    assert.match(describeError(new ApiError(429), "x"), /подождите/);
    assert.match(describeError(new ApiError(400, "invalid"), "Не удалось сохранить"), /^Не удалось сохранить: проверьте/);
    assert.equal(describeError(new ApiError(500), "Не удалось сохранить"), "Не удалось сохранить");
  });
});

describe("isValidFoodWeight", () => {
  test("rejects 0, negatives, NaN and > 5000", () => {
    assert.equal(isValidFoodWeight(0), false);
    assert.equal(isValidFoodWeight(-5), false);
    assert.equal(isValidFoodWeight(Number.NaN), false);
    assert.equal(isValidFoodWeight(5001), false);
    assert.equal(isValidFoodWeight(1), true);
    assert.equal(isValidFoodWeight(250), true);
  });
});

describe("minutesInTimeZone", () => {
  test("время суток в зоне профиля, а не устройства", () => {
    const now = new Date("2026-10-26T14:05:00Z");
    assert.equal(minutesInTimeZone("Europe/Moscow", now), 17 * 60 + 5);
    assert.equal(minutesInTimeZone("Asia/Vladivostok", now), 0 * 60 + 5);
    assert.equal(minutesInTimeZone(null, now), 17 * 60 + 5);
    assert.equal(minutesInTimeZone("Mars/Base", now), 17 * 60 + 5);
  });

  test("полночь — 0, а не 24:00", () => {
    assert.equal(minutesInTimeZone("Europe/Moscow", new Date("2026-10-26T21:00:00Z")), 0);
  });
});

describe("mealTypeByMinutes / mealTypeByTime (shared)", () => {
  test("границы по умолчанию 12:30 / 16:30, концы включительно", () => {
    assert.equal(mealTypeByMinutes(8 * 60), "breakfast");
    assert.equal(mealTypeByMinutes(12 * 60 + 30), "breakfast");
    assert.equal(mealTypeByMinutes(12 * 60 + 31), "lunch");
    assert.equal(mealTypeByMinutes(16 * 60 + 30), "lunch");
    assert.equal(mealTypeByMinutes(16 * 60 + 31), "dinner");
    assert.equal(mealTypeByMinutes(3 * 60), "dinner");
  });

  test("свои границы из профиля", () => {
    const b = { breakfastEnd: "10:00", lunchEnd: "15:00" };
    assert.equal(mealTypeByMinutes(10 * 60 + 30, b), "lunch");
    assert.equal(mealTypeByMinutes(15 * 60 + 30, b), "dinner");
  });

  test("mealTypeByTime читает локальные часы Date", () => {
    assert.equal(mealTypeByTime(new Date(2026, 0, 1, 13, 0)), "lunch");
  });
});

describe("weekBarTone / weekBarHeight", () => {
  test("тон по доле от цели", () => {
    assert.equal(weekBarTone(0, 2000, false), "empty");
    assert.equal(weekBarTone(0, 2000, true), "empty");
    assert.equal(weekBarTone(1500, 2000, true), "today");
    assert.equal(weekBarTone(2000, 2000, false), "ok");
    assert.equal(weekBarTone(2200, 2000, false), "near");
    assert.equal(weekBarTone(2201, 2000, false), "over");
    assert.equal(weekBarTone(1800, null, false), "neutral");
    assert.equal(weekBarTone(1800, 0, false), "neutral");
  });

  test("высота: доля цели с потолком 1, без цели — от максимума недели", () => {
    assert.equal(weekBarHeight(1000, 2000, 3000), 0.5);
    assert.equal(weekBarHeight(2500, 2000, 3000), 1);
    assert.equal(weekBarHeight(1500, null, 3000), 0.5);
    assert.equal(weekBarHeight(0, null, 0), 0);
  });
});

describe("proteinTip", () => {
  // 18:00 по Москве.
  const evening = new Date("2026-10-26T15:00:00Z");
  const base = {
    protein: 60,
    proteinGoal: 140,
    calories: 1300,
    caloriesGoal: 2100,
    timezone: "Europe/Moscow",
    mealLunchEnd: "16:30",
    now: evening,
  };

  test("вечером при нехватке белка — подсказка с остатком", () => {
    assert.equal(proteinTip(base), "На ужин добавьте белка: до цели не хватает 80 г.");
  });

  test("до конца обеда — нет", () => {
    assert.equal(proteinTip({ ...base, now: new Date("2026-10-26T12:00:00Z") }), null);
  });

  test("время считается по таймзоне профиля", () => {
    // 15:00 UTC = 01:00 во Владивостоке — ещё не вечер.
    assert.equal(proteinTip({ ...base, timezone: "Asia/Vladivostok" }), null);
  });

  test("без mealLunchEnd граница 16:30", () => {
    assert.ok(proteinTip({ ...base, mealLunchEnd: null }));
  });

  test("не хватает ≤ 20 г, нет цели или калории кончились — нет", () => {
    assert.equal(proteinTip({ ...base, protein: 120 }), null);
    assert.equal(proteinTip({ ...base, proteinGoal: null }), null);
    assert.equal(proteinTip({ ...base, calories: 2100 }), null);
    assert.equal(proteinTip({ ...base, caloriesGoal: null }), null);
  });
});

describe("foodEmoji", () => {
  test("ключевые слова без учёта регистра", () => {
    assert.equal(foodEmoji("Латте"), "☕");
    assert.equal(foodEmoji("Куриная грудка с рисом"), "🍗");
    assert.equal(foodEmoji("Овсянка на молоке"), "🥣");
    assert.equal(foodEmoji("Протеиновый батончик"), "🍫");
    assert.equal(foodEmoji("Салат цезарь"), "🥗");
    assert.equal(foodEmoji("Борщ"), "🍲");
    assert.equal(foodEmoji("Стейк из лосося"), "🐟");
    assert.equal(foodEmoji("Греческий йогурт"), "🥛");
    assert.equal(foodEmoji("Банан"), "🍎");
    assert.equal(foodEmoji("Бутерброд с сыром"), "🥪");
    assert.equal(foodEmoji("Паста карбонара"), "🍽️");
  });
});

describe("stats summary", () => {
  const days = [
    { date: "2026-10-20", calories: 2000, protein: 100, fat: 70, carbs: 200 },
    { date: "2026-10-21", calories: 0, protein: 0, fat: 0, carbs: 0 },
    { date: "2026-10-22", calories: 1600, protein: 80, fat: 50, carbs: 180 },
    { date: "2026-10-23", calories: 2400, protein: 120, fat: 90, carbs: 250 },
  ];

  test("среднее только по дням с калориями", () => {
    assert.equal(averageCalories(days), 2000);
    assert.deepEqual(averageMacros(days), { protein: 100, fat: 70, carbs: 210 });
    assert.equal(averageCalories([{ calories: 0 }]), null);
    assert.equal(averageMacros([]), null);
  });

  test("минимум и максимум с днём, пустые дни мимо", () => {
    const ext = calorieExtremes(days);
    assert.equal(ext?.min.date, "2026-10-22");
    assert.equal(ext?.max.date, "2026-10-23");
    assert.equal(calorieExtremes([{ calories: 0 }]), null);
  });

  test("неполный сегодняшний день не попадает в сводки недели", () => {
    const rows = withoutDay(days, "2026-10-23");
    assert.deepEqual(rows.map((r) => r.date), ["2026-10-20", "2026-10-21", "2026-10-22"]);
    assert.equal(averageCalories(rows), 1800);
    // Строки без даты (недели в режиме «Месяц») не трогаем.
    assert.equal(withoutDay([{ calories: 1 }], "2026-10-23").length, 1);
  });
});

describe("weightTrend", () => {
  const now = new Date(2026, 9, 26, 12);
  // Как в API: новые сверху.
  const logs = [
    { weight: 78.6, date: "2026-10-26T06:00:00.000Z" },
    { weight: 79.2, date: "2026-10-12T06:00:00.000Z" },
    { weight: 80.0, date: "2026-09-28T06:00:00.000Z" },
    { weight: 82.0, date: "2026-08-01T06:00:00.000Z" },
  ];

  test("изменение за последние 30 дней, точки по возрастанию даты", () => {
    const t = weightTrend(logs, now);
    assert.equal(t?.current, 78.6);
    assert.equal(t?.delta, -1.4);
    assert.equal(t?.monthWindow, true);
    assert.deepEqual(t?.points.map((p) => p.date), ["2026-09-28", "2026-10-12", "2026-10-26"]);
  });

  test("в окне меньше двух точек — весь период", () => {
    const t = weightTrend([logs[0], logs[3]], now);
    assert.equal(t?.monthWindow, false);
    assert.equal(t?.delta, -3.4);
  });

  test("одна запись — без изменения, пусто — null", () => {
    assert.equal(weightTrend([logs[0]], now)?.delta, null);
    assert.equal(weightTrend([], now), null);
  });
});

describe("date labels", () => {
  test("заголовки дат по макету", () => {
    assert.equal(formatDayTitle("2026-10-26"), "Пн, 26 октября");
    assert.equal(formatDateLong("2026-10-24"), "Суббота, 24 октября");
    assert.equal(formatDateRange("2026-10-20", "2026-10-26"), "20–26 октября");
    assert.equal(formatDateRange("2026-09-28", "2026-10-04"), "28 сентября – 4 октября");
    assert.equal(formatDayMonthShort("2026-09-28"), "28 сен");
    assert.equal(weekdayShort("2026-10-26"), "Пн");
  });
});

describe("pickAudioMimeType", () => {
  test("первый поддерживаемый по порядку: webm/opus → mp4 → ogg/opus", () => {
    assert.equal(pickAudioMimeType(() => true), "audio/webm;codecs=opus");
    assert.equal(pickAudioMimeType((t) => t === "audio/mp4"), "audio/mp4");
    assert.equal(pickAudioMimeType((t) => t.startsWith("audio/ogg")), "audio/ogg;codecs=opus");
    assert.deepEqual(AUDIO_MIME_CANDIDATES.length, 3);
  });

  test("ничего не поддержано или isTypeSupported бросает — null", () => {
    assert.equal(pickAudioMimeType(() => false), null);
    assert.equal(
      pickAudioMimeType(() => {
        throw new Error("x");
      }),
      null,
    );
  });
});
