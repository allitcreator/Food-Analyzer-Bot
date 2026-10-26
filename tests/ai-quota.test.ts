/**
 * Дневной лимит AI-действий в Telegram-боте и потолок длины голосового.
 * Счётчик живёт в памяти, ключ — пользователь + календарный день в его
 * часовом поясе. Время подставляем руками, бот и конфиг не нужны.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createAiQuota,
  dayKeyInTz,
  msUntilNextDay,
  formatDuration,
  buildQuotaExceededMessage,
  checkVoiceDuration,
  parsePositiveInt,
} from "../server/lib/ai-quota";

const TZ = "Europe/Moscow";

function clock(iso: string) {
  let now = new Date(iso);
  return {
    now: () => now,
    set(next: string) { now = new Date(next); },
  };
}

describe("dayKeyInTz", () => {
  test("дата берётся в часовом поясе пользователя, а не UTC", () => {
    // 22:30 UTC — в Москве уже следующий день.
    assert.equal(dayKeyInTz(new Date("2026-10-26T22:30:00Z"), TZ), "2026-10-27");
    assert.equal(dayKeyInTz(new Date("2026-10-26T22:30:00Z"), "UTC"), "2026-10-26");
  });

  test("кривой часовой пояс не роняет, а откатывается на UTC", () => {
    assert.equal(dayKeyInTz(new Date("2026-10-26T22:30:00Z"), "Not/AZone"), "2026-10-26");
  });
});

describe("msUntilNextDay", () => {
  test("до полуночи по времени пользователя", () => {
    // 20:00 UTC = 23:00 МСК → до полуночи час.
    assert.equal(msUntilNextDay(new Date("2026-10-26T20:00:00Z"), TZ), 60 * 60 * 1000);
  });

  test("formatDuration округляет вверх до минуты", () => {
    assert.equal(formatDuration(60 * 60 * 1000), "1 ч 0 мин");
    assert.equal(formatDuration(5 * 60 * 1000 + 1), "6 мин");
    assert.equal(formatDuration(0), "1 мин");
  });
});

describe("createAiQuota", () => {
  test("пропускает до лимита запросов и режет следующий", () => {
    const c = clock("2026-10-26T09:00:00Z");
    const q = createAiQuota({ dailyRequests: 3, dailyPhotos: 10 }, c.now);
    for (let i = 0; i < 3; i++) assert.equal(q.tryConsume("1", TZ, "request").allowed, true);
    const denied = q.tryConsume("1", TZ, "request");
    assert.equal(denied.allowed, false);
    if (!denied.allowed) {
      assert.equal(denied.reason, "requests");
      assert.equal(denied.limit, 3);
    }
  });

  test("фото считается и в фото, и в общий лимит; отказ не списывает", () => {
    const c = clock("2026-10-26T09:00:00Z");
    const q = createAiQuota({ dailyRequests: 5, dailyPhotos: 2 }, c.now);
    assert.equal(q.tryConsume("1", TZ, "photo").allowed, true);
    assert.equal(q.tryConsume("1", TZ, "photo").allowed, true);
    const denied = q.tryConsume("1", TZ, "photo");
    assert.equal(denied.allowed, false);
    if (!denied.allowed) assert.equal(denied.reason, "photos");
    assert.deepEqual(q.usage("1", TZ), { requests: 2, photos: 2 });
    // Текст ещё можно: общий лимит не исчерпан.
    assert.equal(q.tryConsume("1", TZ, "request").allowed, true);
    assert.equal(q.tryConsume("1", TZ, "request").allowed, true);
    assert.equal(q.tryConsume("1", TZ, "request").allowed, true);
    const total = q.tryConsume("1", TZ, "request");
    assert.equal(total.allowed, false);
    if (!total.allowed) assert.equal(total.reason, "requests");
  });

  test("исчерпанный общий лимит режет и фото", () => {
    const c = clock("2026-10-26T09:00:00Z");
    const q = createAiQuota({ dailyRequests: 1, dailyPhotos: 10 }, c.now);
    assert.equal(q.tryConsume("1", TZ, "request").allowed, true);
    const denied = q.tryConsume("1", TZ, "photo");
    assert.equal(denied.allowed, false);
    if (!denied.allowed) assert.equal(denied.reason, "requests");
  });

  test("пользователи считаются отдельно", () => {
    const c = clock("2026-10-26T09:00:00Z");
    const q = createAiQuota({ dailyRequests: 1, dailyPhotos: 1 }, c.now);
    assert.equal(q.tryConsume("1", TZ, "request").allowed, true);
    assert.equal(q.tryConsume("2", TZ, "request").allowed, true);
    assert.equal(q.tryConsume("1", TZ, "request").allowed, false);
  });

  test("сбрасывается в полночь по времени пользователя", () => {
    const c = clock("2026-10-26T20:59:00Z"); // 23:59 МСК
    const q = createAiQuota({ dailyRequests: 1, dailyPhotos: 1 }, c.now);
    assert.equal(q.tryConsume("1", TZ, "request").allowed, true);
    assert.equal(q.tryConsume("1", TZ, "request").allowed, false);
    c.set("2026-10-26T21:00:00Z"); // 00:00 МСК
    assert.equal(q.tryConsume("1", TZ, "request").allowed, true);
  });

  test("уведомление админу — только на первый отказ за день", () => {
    const c = clock("2026-10-26T09:00:00Z");
    const q = createAiQuota({ dailyRequests: 1, dailyPhotos: 1 }, c.now);
    q.tryConsume("1", TZ, "request");
    const first = q.tryConsume("1", TZ, "request");
    const second = q.tryConsume("1", TZ, "photo");
    assert.equal(first.allowed === false && first.firstDenialToday, true);
    assert.equal(second.allowed === false && second.firstDenialToday, false);
    c.set("2026-10-27T09:00:00Z");
    q.tryConsume("1", TZ, "request");
    const nextDay = q.tryConsume("1", TZ, "request");
    assert.equal(nextDay.allowed === false && nextDay.firstDenialToday, true);
  });
});

describe("buildQuotaExceededMessage", () => {
  test("называет лимит и когда он сбросится", () => {
    const text = buildQuotaExceededMessage(
      { allowed: false, reason: "photos", limit: 40, firstDenialToday: true },
      2 * 60 * 60 * 1000 + 5 * 60 * 1000,
    );
    assert.match(text, /40/);
    assert.match(text, /фото/);
    assert.match(text, /2 ч 5 мин/);
  });
});

describe("checkVoiceDuration", () => {
  test("короткое голосовое проходит, длинное — нет", () => {
    assert.equal(checkVoiceDuration(300, 300).ok, true);
    assert.equal(checkVoiceDuration(301, 300).ok, false);
  });

  test("неизвестная длительность не блокирует", () => {
    assert.equal(checkVoiceDuration(undefined, 300).ok, true);
  });
});

describe("parsePositiveInt", () => {
  test("берёт целое > 0, иначе значение по умолчанию", () => {
    assert.equal(parsePositiveInt("200", 150), 200);
    assert.equal(parsePositiveInt(undefined, 150), 150);
    assert.equal(parsePositiveInt("", 150), 150);
    assert.equal(parsePositiveInt("0", 150), 150);
    assert.equal(parsePositiveInt("-5", 150), 150);
    assert.equal(parsePositiveInt("abc", 150), 150);
    assert.equal(parsePositiveInt("12.5", 150), 150);
  });
});
