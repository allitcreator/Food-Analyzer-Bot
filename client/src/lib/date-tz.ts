/**
 * «Сегодня» в таймзоне профиля. Сервер считает экран «Сегодня» по
 * user.timezone (по умолчанию Europe/Moscow), а не по часам устройства, — клиент
 * должен совпадать с ним, иначе в Истории «сегодня» и «вчера» разъезжаются.
 */
import { toISO } from "./format";

export const DEFAULT_TIMEZONE = "Europe/Moscow";

function isoInZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Календарная дата "YYYY-MM-DD" в таймзоне `tz` (пустая → Europe/Moscow). */
export function todayInTimeZone(tz: string | null | undefined, now: Date = new Date()): string {
  for (const zone of [tz || DEFAULT_TIMEZONE, DEFAULT_TIMEZONE]) {
    try {
      return isoInZone(now, zone);
    } catch {
      /* неизвестная зона или Intl без timeZone — пробуем следующий вариант */
    }
  }
  return toISO(now);
}

function minutesInZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Часть старых движков отдаёт полночь как "24" даже при h23.
  return (get("hour") % 24) * 60 + get("minute");
}

/** Минуты от полуночи в таймзоне `tz` (пустая или неизвестная → Europe/Moscow). */
export function minutesInTimeZone(tz: string | null | undefined, now: Date = new Date()): number {
  for (const zone of [tz || DEFAULT_TIMEZONE, DEFAULT_TIMEZONE]) {
    try {
      return minutesInZone(now, zone);
    } catch {
      /* неизвестная зона — пробуем следующий вариант */
    }
  }
  return now.getHours() * 60 + now.getMinutes();
}
