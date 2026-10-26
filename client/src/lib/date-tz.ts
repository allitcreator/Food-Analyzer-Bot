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
