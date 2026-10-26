/**
 * Чистая логика планировщика уведомлений: «пора ли слать» с окном догона,
 * ключ claim для снуза умного напоминания, защита тиков от наложения и фильтр
 * получателей (заблокированным не шлём). БД и Telegram не участвуют.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseHHMM,
  isScheduledDue,
  CATCH_UP_WINDOW_MIN,
  smartSnoozeClaimKind,
  createNonOverlapping,
  isNotificationRecipient,
} from "../server/lib/scheduler";

const m = (hhmm: string) => parseHHMM(hhmm)!;

describe("parseHHMM", () => {
  test("валидное время → минуты суток", () => {
    assert.equal(parseHHMM("00:00"), 0);
    assert.equal(parseHHMM("07:30"), 450);
    assert.equal(parseHHMM("23:59"), 1439);
    assert.equal(parseHHMM("7:05"), 425);
  });
  test("off, пусто, мусор и выход за сутки → null", () => {
    for (const v of ["off", "", null, undefined, "24:00", "12:60", "ab:cd", "1230"]) {
      assert.equal(parseHHMM(v as any), null, String(v));
    }
  });
});

describe("isScheduledDue", () => {
  test("ровно в минуту расписания — пора", () => {
    assert.equal(isScheduledDue("21:00", m("21:00")), true);
  });
  test("минутой раньше — ещё рано", () => {
    assert.equal(isScheduledDue("21:00", m("20:59")), false);
  });
  test("тик опоздал на несколько минут (медленный AI у соседа) — всё ещё пора", () => {
    assert.equal(isScheduledDue("21:00", m("21:03")), true);
  });
  test("в пределах окна догона — пора, за окном — уже нет", () => {
    assert.equal(CATCH_UP_WINDOW_MIN, 120);
    assert.equal(isScheduledDue("08:00", m("10:00")), true);
    assert.equal(isScheduledDue("08:00", m("10:01")), false);
    // после рестарта вечером утреннее напоминание не шлём
    assert.equal(isScheduledDue("08:00", m("20:00")), false);
  });
  test("переход через полночь: вчерашнее 23:30 в 00:10 не догоняем", () => {
    assert.equal(isScheduledDue("23:30", m("00:10")), false);
    assert.equal(isScheduledDue("23:59", m("00:00")), false);
  });
  test("время 00:00 срабатывает в полночь и чуть позже", () => {
    assert.equal(isScheduledDue("00:00", m("00:00")), true);
    assert.equal(isScheduledDue("00:00", m("00:30")), true);
  });
  test("off / пусто / мусор — никогда", () => {
    assert.equal(isScheduledDue("off", m("12:00")), false);
    assert.equal(isScheduledDue(null, m("12:00")), false);
    assert.equal(isScheduledDue(undefined, m("12:00")), false);
    assert.equal(isScheduledDue("abc", m("12:00")), false);
  });
  test("окно можно задать явно", () => {
    assert.equal(isScheduledDue("12:00", m("12:10"), 5), false);
    assert.equal(isScheduledDue("12:00", m("12:05"), 5), true);
  });
});

describe("smartSnoozeClaimKind", () => {
  test("разные снузы одного приёма дают разные ключи (повторный снуз не глохнет)", () => {
    const a = smartSnoozeClaimKind("lunch", "2026-10-26T12:00:00.000Z");
    const b = smartSnoozeClaimKind("lunch", "2026-10-26T13:05:00.000Z");
    assert.notEqual(a, b);
  });
  test("один и тот же снуз — один ключ (идемпотентно между тиками и рестартами)", () => {
    assert.equal(
      smartSnoozeClaimKind("dinner", "2026-10-26T18:00:00.000Z"),
      smartSnoozeClaimKind("dinner", "2026-10-26T18:00:00.000Z"),
    );
  });
  test("ключ содержит приём и не совпадает с ключом основного пинга", () => {
    const k = smartSnoozeClaimKind("breakfast", "2026-10-26T08:00:00.000Z");
    assert.match(k, /^smart_breakfast_/);
    assert.notEqual(k, "smart_breakfast");
  });
});

describe("createNonOverlapping", () => {
  test("пока тик идёт, следующий пропускается; после завершения — снова запускается", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let skipped = 0;
    const run = createNonOverlapping(async () => { calls++; await gate; }, () => { skipped++; });

    const first = run();
    const second = await run();
    assert.equal(second, false);
    assert.equal(skipped, 1);
    assert.equal(calls, 1);

    release();
    assert.equal(await first, true);
    assert.equal(await run(), true);
    assert.equal(calls, 2);
  });
  test("исключение внутри снимает флаг", async () => {
    let calls = 0;
    const run = createNonOverlapping(async () => { calls++; throw new Error("db down"); });
    await assert.rejects(run());
    await assert.rejects(run());
    assert.equal(calls, 2);
  });
});

describe("isNotificationRecipient", () => {
  test("одобренный и не заблокированный — получатель", () => {
    assert.equal(isNotificationRecipient({ isApproved: true, isBlocked: false }), true);
    assert.equal(isNotificationRecipient({ isApproved: true, isBlocked: null }), true);
  });
  test("заблокированный не получает, даже если одобрен", () => {
    assert.equal(isNotificationRecipient({ isApproved: true, isBlocked: true }), false);
  });
  test("неодобренный не получает", () => {
    assert.equal(isNotificationRecipient({ isApproved: false, isBlocked: false }), false);
    assert.equal(isNotificationRecipient({ isApproved: null, isBlocked: false }), false);
  });
});
