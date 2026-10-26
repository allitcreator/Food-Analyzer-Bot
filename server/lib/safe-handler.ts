/**
 * Обёртка для обработчиков бота и тика планировщика: исключение внутри не
 * роняет процесс.
 *
 * node-telegram-bot-api вызывает слушатели `message`/`callback_query`/`onText`
 * синхронно через EventEmitter и возвращённый промис не ждёт. Если async-
 * хендлер падает (база перезапускается, Telegram вернул 400), промис
 * отклоняется без обработчика, а Node с 15-й версии на `unhandledRejection`
 * завершает процесс. То же с `setInterval(checkScheduledNotifications)`.
 *
 * Обёртка ловит и синхронный throw, и reject, пишет в лог только имя хендлера
 * и `describeError` (без объекта ошибки и текста пользователя) и ничего не
 * пробрасывает. `onError` — необязательная реакция для пользователя, например
 * `answerCallbackQuery`, чтобы не крутилась кнопка; её сбой тоже глотается.
 */
import { describeError } from "./safe-log";

export type SafeHandlerOptions<A extends unknown[]> = {
  /** Куда писать строку лога. По умолчанию `console.error`. */
  log?: (line: string) => void;
  /** Что сделать после ошибки (ответить на callback и т.п.). */
  onError?: (err: unknown, ...args: A) => unknown;
};

export function safeHandler<A extends unknown[]>(
  name: string,
  fn: (...args: A) => unknown,
  opts: SafeHandlerOptions<A> = {},
): (...args: A) => Promise<void> {
  const write = opts.log ?? ((line: string) => console.error(line));
  return async (...args: A) => {
    try {
      await fn(...args);
    } catch (err) {
      write(`[${name}] handler failed: ${describeError(err)}`);
      if (!opts.onError) return;
      try {
        await opts.onError(err, ...args);
      } catch (err2) {
        write(`[${name}] onError failed: ${describeError(err2)}`);
      }
    }
  };
}

/**
 * Имя для лога по регулярке `onText`: `/^\/help(@\w+)?$/` → `/help`.
 * Берётся из исходника регулярки, то есть из нашего кода, не из сообщения.
 */
export function handlerNameForPattern(re: RegExp): string {
  const m = re.source.match(/^\^\\\/(\w+)/);
  return m ? `/${m[1]}` : "onText";
}
