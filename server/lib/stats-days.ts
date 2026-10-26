/**
 * Дни для недельной/месячной статистики — чистые функции поверх lib/tz:
 * какие календарные дни (в зоне пользователя) входят в период и как
 * разложить записи по этим дням.
 */
import { addDaysKey, formatKeyDm, todayKey, weekdayOfKey } from "./tz";

const DAY_RU = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

/** `n` дней по возрастанию, последний — `endKey` ("YYYY-MM-DD"). */
export function dayKeysEndingAt(endKey: string, n: number): string[] {
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) keys.push(addDaysKey(endKey, -i));
  return keys;
}

/** Последние `n` дней по возрастанию, последний — «сегодня» в зоне `tz`. */
export function lastNDayKeys(now: Date, tz: string | null | undefined, n: number): string[] {
  return dayKeysEndingAt(todayKey(now, tz), n);
}

/** "Пн 26.10" для календарного дня. */
export function dayLabelRu(key: string): string {
  return `${DAY_RU[weekdayOfKey(key)]} ${formatKeyDm(key)}`;
}

export interface WeekDef {
  weekLabel: string;
  startKey: string;
  endKey: string;
  dayKeys: string[];
}

/** Четыре недели по 7 дней, последняя кончается «сегодня» в зоне `tz`. */
export function monthlyWeekDefs(now: Date, tz: string | null | undefined): WeekDef[] {
  const today = todayKey(now, tz);
  const defs: WeekDef[] = [];
  for (let w = 3; w >= 0; w--) {
    const endKey = addDaysKey(today, -w * 7);
    const startKey = addDaysKey(endKey, -6);
    const dayKeys: string[] = [];
    for (let d = 0; d < 7; d++) dayKeys.push(addDaysKey(startKey, d));
    defs.push({ weekLabel: `${formatKeyDm(startKey)}–${formatKeyDm(endKey)}`, startKey, endKey, dayKeys });
  }
  return defs;
}

/** Разложить строки по дням `keys` (в зоне `tz`); прочие дни и без даты — мимо. */
export function bucketByDayKey<T extends { date: Date | null }>(
  rows: T[],
  keys: string[],
  tz: string | null | undefined,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const k of keys) out.set(k, []);
  for (const r of rows) {
    if (!r.date) continue;
    out.get(todayKey(r.date, tz))?.push(r);
  }
  return out;
}
