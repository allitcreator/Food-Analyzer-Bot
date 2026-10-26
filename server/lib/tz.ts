/**
 * Календарь в таймзоне пользователя — единственное место, где сервер считает
 * «сегодня», границы суток и время суток. Только Intl, без зависимости от TZ
 * процесса: границы суток — реальные UTC-инстанты, день — строка "YYYY-MM-DD".
 *
 * Неизвестная или пустая зона молча заменяется на DEFAULT_TZ (Europe/Moscow,
 * как исторически по умолчанию у пользователей и в Mini App).
 */

export const DEFAULT_TZ = "Europe/Moscow";

const formatters = new Map<string, Intl.DateTimeFormat>();
const validity = new Map<string, boolean>();

/** Валидная IANA-зона как есть; пустая/неизвестная → DEFAULT_TZ. */
export function resolveTz(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TZ;
  let ok = validity.get(tz);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      ok = true;
    } catch {
      ok = false;
    }
    validity.set(tz, ok);
  }
  return ok ? tz : DEFAULT_TZ;
}

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
      weekday: "short",
      hourCycle: "h23",
    });
    formatters.set(tz, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface ZonedParts {
  year: number;
  /** 1..12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = воскресенье … 6 = суббота */
  weekday: number;
}

/** Календарные поля момента `instant` в зоне `tz`. */
export function zonedParts(instant: Date, tz: string | null | undefined): ZonedParts {
  const parts = formatterFor(resolveTz(tz)).formatToParts(instant);
  const out: ZonedParts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0, weekday: 0 };
  for (const p of parts) {
    switch (p.type) {
      case "year": out.year = Number(p.value); break;
      case "month": out.month = Number(p.value); break;
      case "day": out.day = Number(p.value); break;
      case "hour": out.hour = Number(p.value) % 24; break; // страховка от "24" в полночь
      case "minute": out.minute = Number(p.value); break;
      case "second": out.second = Number(p.value); break;
      case "weekday": out.weekday = WEEKDAYS[p.value] ?? 0; break;
    }
  }
  return out;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function keyOf(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

/** Календарный день "YYYY-MM-DD" момента `instant` в зоне `tz`. */
export function todayKey(instant: Date, tz: string | null | undefined): string {
  const p = zonedParts(instant, tz);
  return keyOf(p.year, p.month, p.day);
}

/** Минуты суток (0..1439) момента `instant` в зоне `tz`. */
export function minutesOfDay(instant: Date, tz: string | null | undefined): number {
  const p = zonedParts(instant, tz);
  return p.hour * 60 + p.minute;
}

/** "YYYY-MM-DD" → поля; неверный формат или несуществующая дата — RangeError. */
function parseKey(key: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (match) {
    const y = Number(match[1]), m = Number(match[2]), d = Number(match[3]);
    const t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d) return { y, m, d };
  }
  throw new RangeError(`invalid date key: ${key}`);
}

/** Строка — существующая дата "YYYY-MM-DD". */
export function isValidDayKey(key: string): boolean {
  try {
    parseKey(key);
    return true;
  } catch {
    return false;
  }
}

/** Сдвиг календарного дня на `n` суток (без привязки к зоне). */
export function addDaysKey(key: string, n: number): string {
  const { y, m, d } = parseKey(key);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return keyOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** День недели календарной даты: 0 = воскресенье. */
export function weekdayOfKey(key: string): number {
  const { y, m, d } = parseKey(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Смещение зоны (мс) в момент `t`: локальное время минус UTC. */
function offsetAt(t: number, tz: string): number {
  const p = zonedParts(new Date(t), tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (t - (((t % 1000) + 1000) % 1000));
}

/** Первый момент календарного дня `key` в зоне `tz` (UTC-инстант, мс). */
function startOfDayMs(key: string, tz: string): number {
  const { y, m, d } = parseKey(key);
  const localMidnight = Date.UTC(y, m - 1, d);
  // Два прохода: смещение могло смениться между приближением и ответом.
  let t = localMidnight - offsetAt(localMidnight, tz);
  t = localMidnight - offsetAt(t, tz);
  const p = zonedParts(new Date(t), tz);
  if (keyOf(p.year, p.month, p.day) === key && p.hour === 0 && p.minute === 0 && p.second === 0) return t;

  // Полуночи нет (переход на летнее время ровно в 00:00) — ищем первый момент
  // даты двоичным поиском в окне ±4 часа. Инвариант: lo < key ≤ hi.
  let lo = t - 4 * 3600_000;
  let hi = t + 4 * 3600_000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (todayKey(new Date(mid), tz) < key) lo = mid; else hi = mid;
  }
  return hi;
}

/**
 * Реальные UTC-границы календарного дня `key` в зоне `tz`: `start` — первый
 * момент суток, `end` — последний миллисекунд (включительно, под `<=`).
 * Корректно при переходах на летнее/зимнее время (сутки 23/25 ч).
 */
export function dayBoundsUtc(key: string, tz: string | null | undefined): { start: Date; end: Date } {
  const zone = resolveTz(tz);
  const start = startOfDayMs(key, zone);
  const next = startOfDayMs(addDaysKey(key, 1), zone);
  return { start: new Date(start), end: new Date(next - 1) };
}

/** Границы периода [начало startKey, конец endKey] в зоне `tz`. */
export function rangeBoundsUtc(
  startKey: string,
  endKey: string,
  tz: string | null | undefined,
): { start: Date; end: Date } {
  return { start: dayBoundsUtc(startKey, tz).start, end: dayBoundsUtc(endKey, tz).end };
}

/** "ДД.ММ.ГГГГ" (ввод пользователя) → "YYYY-MM-DD"; несуществующая дата → null. */
export function parseDmyKey(s: string): string | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim());
  if (!match) return null;
  const key = `${match[3]}-${match[2]}-${match[1]}`;
  return isValidDayKey(key) ? key : null;
}

/** "YYYY-MM-DD" → "ДД.ММ.ГГГГ". */
export function formatKeyDmy(key: string): string {
  const { y, m, d } = parseKey(key);
  return `${pad2(d)}.${pad2(m)}.${y}`;
}

/** "YYYY-MM-DD" → "ДД.ММ". */
export function formatKeyDm(key: string): string {
  const { m, d } = parseKey(key);
  return `${pad2(d)}.${pad2(m)}`;
}

/** Момент как "ДД.ММ" в зоне `tz`. */
export function formatDdMm(instant: Date, tz: string | null | undefined): string {
  return formatKeyDm(todayKey(instant, tz));
}

/**
 * Date, у которой ЛОКАЛЬНЫЕ поля (getHours/getDate…) равны времени `instant`
 * в зоне `tz`. Только для старых потребителей, которые читают время суток
 * через локальные геттеры (mealTypeByTime, подсказка времени для AI). Для
 * границ суток и сравнений с БД не использовать — для этого dayBoundsUtc.
 */
export function wallClockDate(instant: Date, tz: string | null | undefined): Date {
  const p = zonedParts(instant, tz);
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}
