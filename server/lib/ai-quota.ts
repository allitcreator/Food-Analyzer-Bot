/**
 * Дневной лимит AI-действий пользователя в Telegram-боте — потолок трат на
 * OpenRouter, если кто-то (или зациклившийся шорткат) шлёт сообщения подряд.
 *
 * Считается одно действие пользователя (сообщение, фото, голосовое, команда
 * или кнопка с AI-анализом), а не каждый внутренний вызов модели: текст — это
 * classifyIntent + analyzeFoodText, голосовое — несколько кусков транскрипции,
 * и пользователю это знать незачем. Фото дороже (vision), поэтому у него свой
 * потолок поверх общего: фото списывается из обоих.
 *
 * Счётчик в памяти процесса, после рестарта начинается с нуля — для защиты
 * счёта этого достаточно. Сутки — календарный день в часовом поясе
 * пользователя: «сбросится в полночь» совпадает с днём, по которому бот
 * считает статистику. Смена часового пояса может дать лишние несколько часов
 * квоты — для личного бота это приемлемо.
 *
 * В памяти по одной записи на пользователя (только текущий день), поэтому
 * Map не растёт со временем.
 */

export type AiActionKind = "request" | "photo";

export type AiQuotaLimits = {
  /** Все AI-действия за сутки, включая фото. */
  dailyRequests: number;
  /** Только фото за сутки. */
  dailyPhotos: number;
};

export type QuotaCheck =
  | { allowed: true }
  | {
      allowed: false;
      reason: "requests" | "photos";
      limit: number;
      /** Первый отказ этому пользователю за сутки — повод один раз сказать админу. */
      firstDenialToday: boolean;
    };

/** YYYY-MM-DD в часовом поясе `tz`; неизвестный пояс — UTC. */
export function dayKeyInTz(now: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Сколько миллисекунд до ближайшей полуночи в `tz`. */
export function msUntilNextDay(now: Date, tz: string): number {
  let h = now.getUTCHours(), m = now.getUTCMinutes(), s = now.getUTCSeconds();
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    h = get("hour"); m = get("minute"); s = get("second");
  } catch {
    // неизвестный пояс — считаем по UTC
  }
  const elapsed = ((h * 60 + m) * 60 + s) * 1000 + now.getUTCMilliseconds();
  return 24 * 60 * 60 * 1000 - elapsed;
}

/** «2 ч 5 мин» / «6 мин»; минуты округляются вверх, минимум 1. */
export function formatDuration(ms: number): string {
  const totalMin = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

export function createAiQuota(limits: AiQuotaLimits, now: () => Date = () => new Date()) {
  const entries = new Map<string, { day: string; requests: number; photos: number; denied: boolean }>();

  function entryFor(userKey: string, tz: string) {
    const day = dayKeyInTz(now(), tz);
    let e = entries.get(userKey);
    if (!e || e.day !== day) {
      e = { day, requests: 0, photos: 0, denied: false };
      entries.set(userKey, e);
    }
    return e;
  }

  return {
    /** Проверить и, если можно, списать одно действие. Отказ ничего не списывает. */
    tryConsume(userKey: string, tz: string, kind: AiActionKind): QuotaCheck {
      const e = entryFor(userKey, tz);
      let reason: "requests" | "photos" | null = null;
      if (e.requests >= limits.dailyRequests) reason = "requests";
      else if (kind === "photo" && e.photos >= limits.dailyPhotos) reason = "photos";

      if (reason) {
        const firstDenialToday = !e.denied;
        e.denied = true;
        return {
          allowed: false,
          reason,
          limit: reason === "photos" ? limits.dailyPhotos : limits.dailyRequests,
          firstDenialToday,
        };
      }
      e.requests++;
      if (kind === "photo") e.photos++;
      return { allowed: true };
    },
    usage(userKey: string, tz: string): { requests: number; photos: number } {
      const e = entryFor(userKey, tz);
      return { requests: e.requests, photos: e.photos };
    },
  };
}

export type AiQuota = ReturnType<typeof createAiQuota>;

export function buildQuotaExceededMessage(check: Extract<QuotaCheck, { allowed: false }>, resetInMs: number): string {
  const what = check.reason === "photos"
    ? `Лимит распознавания фото на сегодня исчерпан (${check.limit} в сутки).`
    : `Лимит AI-запросов на сегодня исчерпан (${check.limit} в сутки).`;
  const extra = check.reason === "photos"
    ? "Пока можно описать еду текстом или голосом."
    : "Пока можно записать еду из /favorites — без AI.";
  return `⏳ ${what}\nСчётчик обнулится в полночь по вашему времени, через ${formatDuration(resetInMs)}.\n${extra}`;
}

/** Голосовое длиннее `maxSec` не скачиваем и не расшифровываем. */
export function checkVoiceDuration(durationSec: number | undefined, maxSec: number): { ok: true } | { ok: false; maxSec: number } {
  if (durationSec == null || !Number.isFinite(durationSec)) return { ok: true };
  return durationSec > maxSec ? { ok: false, maxSec } : { ok: true };
}

export function buildVoiceTooLongMessage(maxSec: number): string {
  const limit = maxSec % 60 === 0 ? `${maxSec / 60} мин` : `${maxSec} с`;
  return `🎤 Голосовое длиннее ${limit} — такое не распознаю. Разбейте на части покороче или напишите текстом.`;
}

/** Целое > 0 из переменной окружения, иначе `fallback`. */
export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null || !/^\d+$/.test(raw.trim())) return fallback;
  const n = Number(raw.trim());
  return n > 0 ? n : fallback;
}
