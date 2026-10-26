/**
 * Чистая логика планировщика уведомлений (без БД и Telegram).
 *
 * Тик раз в минуту раньше сравнивал «HH:MM сейчас» с расписанием точным
 * равенством. Тик последовательно ждал вечерние AI-отчёты, и у следующих
 * пользователей минута успевала смениться — уведомление терялось на весь день.
 * Теперь правило «запланированное время наступило сегодня и прошло не больше
 * окна догона», а повторную отправку исключает claim в notification_sends
 * (один раз на kind и день пользователя), так что «≥» идемпотентно.
 */

/** Окно догона (мин): после рестарта или долгого тика шлём, если опоздали не
 *  больше чем на 2 часа. Утреннее напоминание вечером уже не приходит. */
export const CATCH_UP_WINDOW_MIN = 120;

/** "HH:MM" → минуты суток (0..1439); "off", пусто и мусор → null. */
export function parseHHMM(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Пора ли слать уведомление, запланированное на `scheduled` ("HH:MM" в tz
 * пользователя), если сейчас `nowMinutes` минут его текущих суток.
 * Только в пределах сегодняшнего дня: вчерашнее 23:30 после полуночи не
 * догоняем (claim уже по новому дню, и напоминание было бы не к месту).
 */
export function isScheduledDue(
  scheduled: string | null | undefined,
  nowMinutes: number,
  windowMin: number = CATCH_UP_WINDOW_MIN,
): boolean {
  const at = parseHHMM(scheduled);
  if (at === null) return false;
  return nowMinutes >= at && nowMinutes - at <= windowMin;
}

/**
 * Kind для claim повторного пинга по снузу «Напомнить позже». В ключе момент
 * окончания снуза (в минутах эпохи): каждый новый снуз получает свой ключ,
 * поэтому второй и следующие снузы за день тоже срабатывают, а один и тот же
 * снуз не уйдёт дважды (между тиками, после рестарта).
 */
export function smartSnoozeClaimKind(meal: string, untilIso: string): string {
  const minutes = Math.floor(new Date(untilIso).getTime() / 60_000);
  return `smart_${meal}_snz${minutes}`;
}

/**
 * Обёртка против наложения тиков: пока предыдущий вызов не завершился, новый
 * пропускается (возвращает false, зовёт onSkip). Исключение снимает флаг и
 * пробрасывается дальше.
 */
export function createNonOverlapping<A extends unknown[]>(
  fn: (...args: A) => Promise<unknown>,
  onSkip?: () => void,
): (...args: A) => Promise<boolean> {
  let inFlight = false;
  return async (...args: A) => {
    if (inFlight) {
      onSkip?.();
      return false;
    }
    inFlight = true;
    try {
      await fn(...args);
    } finally {
      inFlight = false;
    }
    return true;
  };
}

/** Кому слать отчёты и напоминания: одобренным и не заблокированным. */
export function isNotificationRecipient(user: { isApproved: boolean | null; isBlocked: boolean | null }): boolean {
  return user.isApproved === true && user.isBlocked !== true;
}
