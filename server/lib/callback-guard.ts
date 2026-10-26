/**
 * Защита от двойного тапа по inline-кнопке.
 *
 * Telegram доставляет каждый тап отдельным callback_query, и бот обрабатывает
 * их параллельно. Если между чтением состояния и записью в базу есть `await`,
 * второй тап успевает увидеть то же состояние и записать блюдо ещё раз.
 */

/** Набор ключей «уже обрабатывается», обычно `${telegramId}:${query.data}`. */
export function createInFlightGuard() {
  const active = new Set<string>();
  return {
    /** true — ключ захвачен; false — такой же вызов уже идёт. */
    tryAcquire(key: string): boolean {
      if (active.has(key)) return false;
      active.add(key);
      return true;
    },
    release(key: string): void {
      active.delete(key);
    },
    /** Выполнить `fn`, если ключ свободен; ключ отпускается и после ошибки. */
    async run<T>(key: string, fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
      if (active.has(key)) return { ran: false };
      active.add(key);
      try {
        return { ran: true, value: await fn() };
      } finally {
        active.delete(key);
      }
    },
  };
}

/**
 * Забрать отложенную запись и сразу убрать её из хранилища — до любых `await`,
 * чтобы параллельный тап её уже не нашёл.
 */
export function takePending<T>(store: Record<string, T | undefined>, key: string): T | undefined {
  const value = store[key];
  if (value !== undefined) delete store[key];
  return value;
}

/**
 * Вернуть запись после неудачного сохранения, чтобы пользователь мог нажать
 * ещё раз. Если за это время появилась новая запись — её не трогаем.
 */
export function restorePending<T>(store: Record<string, T | undefined>, key: string, value: T): void {
  if (store[key] === undefined) store[key] = value;
}
