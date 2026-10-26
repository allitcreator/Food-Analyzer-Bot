/**
 * Таймзона пользователя: границы суток, «сегодня», минуты суток.
 *
 * Тесты не должны зависеть от TZ процесса — прогоняются как обычно, а также
 * под `TZ=UTC` и `TZ=Asia/Tokyo`. Все ожидания заданы реальными UTC-инстантами.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TZ,
  resolveTz,
  zonedParts,
  todayKey,
  dayBoundsUtc,
  rangeBoundsUtc,
  addDaysKey,
  minutesOfDay,
  weekdayOfKey,
  parseDmyKey,
  formatKeyDmy,
  formatDdMm,
  wallClockDate,
  isValidDayKey,
} from "../server/lib/tz";
import {
  lastNDayKeys,
  dayLabelRu,
  monthlyWeekDefs,
  bucketByDayKey,
} from "../server/lib/stats-days";
import { tickClock } from "../server/lib/scheduler";

const iso = (s: string) => new Date(s);
const HOUR = 3600_000;

describe("resolveTz", () => {
  test("валидная зона возвращается как есть", () => {
    assert.equal(resolveTz("Asia/Yekaterinburg"), "Asia/Yekaterinburg");
    assert.equal(resolveTz("UTC"), "UTC");
  });
  test("пустая/неизвестная → Europe/Moscow", () => {
    assert.equal(DEFAULT_TZ, "Europe/Moscow");
    assert.equal(resolveTz(undefined), DEFAULT_TZ);
    assert.equal(resolveTz(null), DEFAULT_TZ);
    assert.equal(resolveTz(""), DEFAULT_TZ);
    assert.equal(resolveTz("Mars/Olympus"), DEFAULT_TZ);
    assert.equal(resolveTz("not a zone"), DEFAULT_TZ);
  });
  test("функции с неизвестной зоной считают по дефолту, а не падают", () => {
    const t = iso("2026-10-25T21:30:00Z"); // 00:30 MSK 26.10
    assert.equal(todayKey(t, "Mars/Olympus"), "2026-10-26");
    assert.equal(minutesOfDay(t, "bogus"), 30);
  });
});

describe("zonedParts", () => {
  test("Москва, полночь и weekday", () => {
    // 2026-10-26 — понедельник
    const p = zonedParts(iso("2026-10-25T21:00:00Z"), "Europe/Moscow");
    assert.deepEqual(p, { year: 2026, month: 10, day: 26, hour: 0, minute: 0, second: 0, weekday: 1 });
  });
  test("Нью-Йорк, вечер предыдущего дня по UTC", () => {
    const p = zonedParts(iso("2026-10-26T03:59:00Z"), "America/New_York"); // EDT, -4
    assert.deepEqual(p, { year: 2026, month: 10, day: 25, hour: 23, minute: 59, second: 0, weekday: 0 });
  });
  test("Kolkata +5:30", () => {
    const p = zonedParts(iso("2026-01-01T18:29:00Z"), "Asia/Kolkata");
    assert.equal(p.day, 1); assert.equal(p.hour, 23); assert.equal(p.minute, 59);
    const q = zonedParts(iso("2026-01-01T18:30:00Z"), "Asia/Kolkata");
    assert.equal(q.day, 2); assert.equal(q.hour, 0); assert.equal(q.minute, 0);
  });
});

describe("todayKey / addDaysKey / weekdayOfKey", () => {
  test("формат YYYY-MM-DD с ведущими нулями", () => {
    assert.equal(todayKey(iso("2026-01-05T12:00:00Z"), "UTC"), "2026-01-05");
  });
  test("addDaysKey через границы месяца/года/високосного", () => {
    assert.equal(addDaysKey("2026-10-26", 0), "2026-10-26");
    assert.equal(addDaysKey("2026-10-31", 1), "2026-11-01");
    assert.equal(addDaysKey("2026-01-01", -1), "2025-12-31");
    assert.equal(addDaysKey("2028-02-28", 1), "2028-02-29");
    assert.equal(addDaysKey("2026-03-01", -1), "2026-02-28");
    assert.equal(addDaysKey("2026-10-26", -27), "2026-09-29");
  });
  test("weekdayOfKey: 0=Вс", () => {
    assert.equal(weekdayOfKey("2026-10-26"), 1);
    assert.equal(weekdayOfKey("2026-10-25"), 0);
    assert.equal(weekdayOfKey("2026-10-31"), 6);
  });
});

describe("dayBoundsUtc", () => {
  test("Москва: 00:00 MSK = 21:00Z накануне, конец — последний мс суток", () => {
    const b = dayBoundsUtc("2026-10-26", "Europe/Moscow");
    assert.equal(b.start.toISOString(), "2026-10-25T21:00:00.000Z");
    assert.equal(b.end.toISOString(), "2026-10-26T20:59:59.999Z");
  });
  test("Kolkata (+5:30, нецелое смещение)", () => {
    const b = dayBoundsUtc("2026-07-15", "Asia/Kolkata");
    assert.equal(b.start.toISOString(), "2026-07-14T18:30:00.000Z");
    assert.equal(b.end.toISOString(), "2026-07-15T18:29:59.999Z");
  });
  test("Berlin: весенний переход (29.03.2026) — сутки 23 часа", () => {
    const b = dayBoundsUtc("2026-03-29", "Europe/Berlin");
    assert.equal(b.start.toISOString(), "2026-03-28T23:00:00.000Z"); // CET +1
    assert.equal(b.end.toISOString(), "2026-03-29T21:59:59.999Z"); // CEST +2
    assert.equal(b.end.getTime() + 1 - b.start.getTime(), 23 * HOUR);
  });
  test("Berlin: осенний переход (25.10.2026) — сутки 25 часов", () => {
    const b = dayBoundsUtc("2026-10-25", "Europe/Berlin");
    assert.equal(b.start.toISOString(), "2026-10-24T22:00:00.000Z");
    assert.equal(b.end.toISOString(), "2026-10-25T22:59:59.999Z");
    assert.equal(b.end.getTime() + 1 - b.start.getTime(), 25 * HOUR);
  });
  test("New York: переход 08.03.2026 (23 ч) и 01.11.2026 (25 ч)", () => {
    const s = dayBoundsUtc("2026-03-08", "America/New_York");
    assert.equal(s.start.toISOString(), "2026-03-08T05:00:00.000Z");
    assert.equal(s.end.getTime() + 1 - s.start.getTime(), 23 * HOUR);
    const f = dayBoundsUtc("2026-11-01", "America/New_York");
    assert.equal(f.start.toISOString(), "2026-11-01T04:00:00.000Z");
    assert.equal(f.end.getTime() + 1 - f.start.getTime(), 25 * HOUR);
  });

  // Инвариант для всех дней года в разных зонах, включая зоны с переходом
  // ровно в полночь (полуночи нет — сутки начинаются с первого момента даты).
  const ZONES = [
    "Europe/Moscow", "Europe/Berlin", "America/New_York", "Asia/Kolkata",
    "Asia/Yekaterinburg", "America/Santiago", "America/Havana", "Australia/Lord_Howe",
    "Pacific/Chatham", "Asia/Kathmandu", "UTC", "Pacific/Kiritimati",
  ];
  for (const tz of ZONES) {
    test(`инвариант границ на весь 2026 год: ${tz}`, () => {
      let key = "2026-01-01";
      while (key < "2027-01-01") {
        const { start, end } = dayBoundsUtc(key, tz);
        assert.equal(todayKey(start, tz), key, `${tz} ${key} start`);
        assert.equal(todayKey(new Date(start.getTime() - 1), tz), addDaysKey(key, -1), `${tz} ${key} start-1`);
        assert.equal(todayKey(end, tz), key, `${tz} ${key} end`);
        assert.equal(todayKey(new Date(end.getTime() + 1), tz), addDaysKey(key, 1), `${tz} ${key} end+1`);
        const len = end.getTime() + 1 - start.getTime();
        assert.ok(len >= 22 * HOUR && len <= 26 * HOUR, `${tz} ${key} len ${len}`);
        key = addDaysKey(key, 1);
      }
    });
  }

  test("isValidDayKey", () => {
    assert.equal(isValidDayKey("2028-02-29"), true);
    assert.equal(isValidDayKey("2026-02-29"), false);
    assert.equal(isValidDayKey("2026-1-01"), false);
  });

  test("неверный ключ даты — RangeError", () => {
    assert.throws(() => dayBoundsUtc("2026-02-31", "UTC"), RangeError);
    assert.throws(() => dayBoundsUtc("26.10.2026", "UTC"), RangeError);
  });

  test("rangeBoundsUtc: от начала первого до конца последнего дня", () => {
    const r = rangeBoundsUtc("2026-10-20", "2026-10-26", "Europe/Moscow");
    assert.equal(r.start.toISOString(), "2026-10-19T21:00:00.000Z");
    assert.equal(r.end.toISOString(), "2026-10-26T20:59:59.999Z");
  });
});

describe("minutesOfDay", () => {
  test("Москва и Kolkata", () => {
    assert.equal(minutesOfDay(iso("2026-10-25T21:00:00Z"), "Europe/Moscow"), 0);
    assert.equal(minutesOfDay(iso("2026-10-26T06:15:00Z"), "Europe/Moscow"), 9 * 60 + 15);
    assert.equal(minutesOfDay(iso("2026-10-26T06:15:00Z"), "Asia/Kolkata"), 11 * 60 + 45);
  });
});

describe("parseDmyKey / formatKeyDmy / formatDdMm", () => {
  test("ДД.ММ.ГГГГ → ключ, мусор → null", () => {
    assert.equal(parseDmyKey("26.10.2026"), "2026-10-26");
    assert.equal(parseDmyKey("01.01.2026"), "2026-01-01");
    assert.equal(parseDmyKey("31.02.2026"), null);
    assert.equal(parseDmyKey("00.10.2026"), null);
    assert.equal(parseDmyKey("2026-10-26"), null);
  });
  test("формат обратно", () => {
    assert.equal(formatKeyDmy("2026-10-05"), "05.10.2026");
    assert.equal(formatDdMm(iso("2026-10-25T21:30:00Z"), "Europe/Moscow"), "26.10");
    assert.equal(formatDdMm(iso("2026-10-25T21:30:00Z"), "America/New_York"), "25.10");
  });
});

describe("wallClockDate (для потребителей getHours/getMinutes)", () => {
  test("локальные поля = время в tz независимо от TZ процесса", () => {
    const d = wallClockDate(iso("2026-10-25T21:30:00Z"), "Asia/Yekaterinburg"); // 02:30 YEKT 26.10
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 9);
    assert.equal(d.getDate(), 26);
    assert.equal(d.getHours(), 2);
    assert.equal(d.getMinutes(), 30);
  });
});

// ─── Совместимость с прежним поведением ──────────────────────────────────────

/** Прежняя схема: «сдвинутая Date» через toLocaleString + локальные геттеры. */
function legacyKeyAndMinutes(instant: Date, tz: string) {
  const u = new Date(instant.toLocaleString("en-US", { timeZone: tz }));
  return {
    key: `${u.getFullYear()}-${String(u.getMonth() + 1).padStart(2, "0")}-${String(u.getDate()).padStart(2, "0")}`,
    minutes: u.getHours() * 60 + u.getMinutes(),
    dow: u.getDay(),
  };
}

describe("ключ дня claim (notification_sends) совпадает с прежним форматом", () => {
  test("todayKey/minutesOfDay/weekday == старый toUserDate-расчёт", () => {
    const zones = ["Europe/Moscow", "Asia/Yekaterinburg", "America/New_York", "Asia/Kolkata", "Europe/Berlin"];
    // Каждые 37 минут на протяжении ~10 суток вокруг осеннего перехода.
    const from = iso("2026-10-20T00:00:00Z").getTime();
    for (let t = from; t < from + 10 * 24 * HOUR; t += 37 * 60_000) {
      const instant = new Date(t);
      for (const tz of zones) {
        const legacy = legacyKeyAndMinutes(instant, tz);
        const clock = tickClock(instant, tz);
        assert.equal(clock.dayKey, legacy.key, `${tz} ${instant.toISOString()}`);
        assert.equal(clock.nowMinutes, legacy.minutes, `${tz} ${instant.toISOString()}`);
        assert.equal(clock.weekday, legacy.dow, `${tz} ${instant.toISOString()}`);
        assert.equal(todayKey(instant, tz), legacy.key);
      }
    }
  });
  test("tickClock для неизвестной зоны — по Москве", () => {
    const c = tickClock(iso("2026-10-25T21:05:00Z"), "nope/zone");
    assert.deepEqual(c, { dayKey: "2026-10-26", nowMinutes: 5, weekday: 1 });
  });
});

describe("Europe/Moscow: поведение как при сервере в Europe/Moscow", () => {
  // Прежде: getNow(tz) + setHours(0,0,0,0) в зоне контейнера Europe/Moscow =
  // полночь по Москве. Фиксируем те же инстанты.
  const cases: Array<[string, string, string, string]> = [
    // момент (UTC)              день     start (UTC)                  end (UTC)
    ["2026-10-25T20:59:59.999Z", "2026-10-25", "2026-10-24T21:00:00.000Z", "2026-10-25T20:59:59.999Z"], // 23:59:59 MSK
    ["2026-10-25T21:00:00.000Z", "2026-10-26", "2026-10-25T21:00:00.000Z", "2026-10-26T20:59:59.999Z"], // 00:00 MSK
    ["2026-10-25T21:30:00.000Z", "2026-10-26", "2026-10-25T21:00:00.000Z", "2026-10-26T20:59:59.999Z"], // 00:30 MSK
    ["2026-10-26T09:00:00.000Z", "2026-10-26", "2026-10-25T21:00:00.000Z", "2026-10-26T20:59:59.999Z"], // 12:00 MSK
    ["2026-12-31T21:00:00.000Z", "2027-01-01", "2026-12-31T21:00:00.000Z", "2027-01-01T20:59:59.999Z"], // Новый год
  ];
  for (const [now, key, start, end] of cases) {
    test(`${now} → ${key}`, () => {
      const tz = "Europe/Moscow";
      assert.equal(todayKey(iso(now), tz), key);
      const b = dayBoundsUtc(key, tz);
      assert.equal(b.start.toISOString(), start);
      assert.equal(b.end.toISOString(), end);
    });
  }
  test("неделя для Москвы: 7 ключей, последний — сегодня по Москве", () => {
    const keys = lastNDayKeys(iso("2026-10-25T21:30:00Z"), "Europe/Moscow", 7);
    assert.deepEqual(keys, [
      "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26",
    ]);
  });
});

describe("пользователь не в Москве: запись в 00:30 местного — «сегодня» местного", () => {
  const cases: Array<[string, string, string]> = [
    // tz, момент записи (00:30 местного), ожидаемый день
    ["Asia/Yekaterinburg", "2026-10-25T19:30:00Z", "2026-10-26"], // +5
    ["America/New_York", "2026-10-26T04:30:00Z", "2026-10-26"], // EDT -4
    ["America/New_York", "2026-11-02T05:30:00Z", "2026-11-02"], // EST -5
  ];
  for (const [tz, at, day] of cases) {
    test(`${tz} ${at}`, () => {
      const instant = iso(at);
      assert.equal(todayKey(instant, tz), day);
      const b = dayBoundsUtc(day, tz);
      assert.ok(instant >= b.start && instant <= b.end);
      // В корзину «сегодня» попадает, во «вчера» — нет.
      const buckets = bucketByDayKey([{ date: instant, v: 1 }], [addDaysKey(day, -1), day], tz);
      assert.deepEqual(buckets.get(day)?.length, 1);
      assert.deepEqual(buckets.get(addDaysKey(day, -1))?.length, 0);
    });
  }
  test("Екатеринбург в 00:30: «сегодня» уже новый день, хотя в Москве ещё вчера", () => {
    const instant = iso("2026-10-25T19:30:00Z"); // 00:30 YEKT, 22:30 MSK
    assert.equal(todayKey(instant, "Asia/Yekaterinburg"), "2026-10-26");
    assert.equal(todayKey(instant, "Europe/Moscow"), "2026-10-25");
  });
});

describe("stats-days", () => {
  test("dayLabelRu", () => {
    assert.equal(dayLabelRu("2026-10-26"), "Пн 26.10");
    assert.equal(dayLabelRu("2026-10-25"), "Вс 25.10");
  });
  test("lastNDayKeys по зоне пользователя", () => {
    const now = iso("2026-10-26T04:30:00Z"); // 00:30 NY 26.10, 07:30 MSK
    assert.deepEqual(lastNDayKeys(now, "America/New_York", 2), ["2026-10-25", "2026-10-26"]);
    assert.deepEqual(lastNDayKeys(iso("2026-10-26T03:30:00Z"), "America/New_York", 2), ["2026-10-24", "2026-10-25"]);
  });
  test("monthlyWeekDefs: 4 недели по 7 дней, последняя кончается сегодня", () => {
    const defs = monthlyWeekDefs(iso("2026-10-25T21:30:00Z"), "Europe/Moscow");
    assert.equal(defs.length, 4);
    assert.deepEqual(defs.map((d) => d.weekLabel), [
      "29.09–05.10", "06.10–12.10", "13.10–19.10", "20.10–26.10",
    ]);
    assert.equal(defs[3].endKey, "2026-10-26");
    assert.equal(defs[3].startKey, "2026-10-20");
    assert.equal(defs[3].weekLabel, "20.10–26.10");
    assert.equal(defs[0].startKey, "2026-09-29");
    assert.equal(defs[0].weekLabel, "29.09–05.10");
    for (const d of defs) assert.equal(d.dayKeys.length, 7);
    assert.equal(defs.flatMap((d) => d.dayKeys).length, 28);
  });
  test("bucketByDayKey: строки вне ключей и без даты игнорируются", () => {
    const tz = "Europe/Moscow";
    const rows = [
      { date: iso("2026-10-25T20:59:59.999Z"), v: 1 }, // 25.10
      { date: iso("2026-10-25T21:00:00.000Z"), v: 2 }, // 26.10
      { date: null, v: 3 },
      { date: iso("2026-10-01T10:00:00Z"), v: 4 },
    ];
    const m = bucketByDayKey(rows, ["2026-10-25", "2026-10-26"], tz);
    assert.deepEqual(m.get("2026-10-25")!.map((r) => r.v), [1]);
    assert.deepEqual(m.get("2026-10-26")!.map((r) => r.v), [2]);
  });
});
