/**
 * Проверка секрета Telegram-вебхука.
 *
 * Раньше секрет стоял в пути эндпоинта (`/api/telegram-webhook/<secret>`), а
 * путь печатает request-логгер на каждом апдейте — то есть секрет лежал в
 * docker logs в открытом виде и жил там до ротации. Теперь путь фиксированный,
 * а единственная проверка — заголовок `x-telegram-bot-api-secret-token`,
 * который Telegram шлёт сам (`setWebHook({ secret_token })`).
 *
 * Сравнение идёт за постоянное время: обычный `!==` выходит на первом
 * несовпавшем байте, и по времени ответа секрет подбирается посимвольно.
 */
import crypto from "node:crypto";

/**
 * Совпадают ли два секрета.
 *
 * Заголовок приходит из `req.headers`, поэтому на вход годится что угодно:
 * `undefined`, массив (заголовок пришёл дважды), число. Всё, что не строка, —
 * не совпадение. Пустая строка тоже: незаполненный `WEBHOOK_SECRET` иначе
 * открыл бы эндпоинт любому, кто пришлёт пустой заголовок.
 */
export function secretsMatch(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || b.length === 0) return false;

  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // timingSafeEqual кидает на буферах разной длины, поэтому длину сверяем сами.
  // Утечка длины секрета не страшна: она и так видна в конфиге деплоя.
  if (left.length !== right.length) return false;

  return crypto.timingSafeEqual(left, right);
}
