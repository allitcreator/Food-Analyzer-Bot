/**
 * Короткое описание ошибки для лога — без пользовательского контента.
 *
 * Зачем это вообще нужно. `console.error("...", err)` печатает объект ошибки
 * целиком, а у наших ошибок внутри лежат данные пользователя:
 *
 * - `TelegramError` из node-telegram-bot-api несёт поле `response` с полным
 *   объектом запроса; в `response.request` лежит form с текстом, который бот
 *   отправлял пользователю (а значит — и разбор его еды, и профиль);
 * - ошибки body-parser (`type: "entity.parse.failed"`) несут `err.body` с
 *   сырым телом запроса, то есть с тем, что прислал клиент.
 *
 * В docker logs это уезжает как есть и живёт там до ротации. Поэтому в лог
 * идут только служебные поля: имя, message, коды и несколько фреймов стека. Ни
 * `response`, ни `request`, ни `body`, ни `options`, ни `error` мы не читаем и
 * объект целиком не сериализуем.
 *
 * Отдельный случай — ошибки разбора JSON: у них пользовательский контент сидит
 * в самом `message` (см. `isParseFailure`).
 */

/** Значение, которое можно безопасно подставить в строку лога. */
function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** Сколько фреймов стека оставляем: дальше идёт кухня express и node. */
const MAX_STACK_FRAMES = 5;

/**
 * Фреймы стека — единственная часть ошибки, по которой видно, откуда она.
 *
 * Берём только строки вида `    at ...`, а не «всё после первой»: message
 * бывает многострочным, и тогда его хвост уехал бы в лог под видом фрейма.
 */
function stackFrames(err: unknown): string {
  if (!(err instanceof Error) || typeof err.stack !== "string") return "";

  const frames = err.stack
    .split("\n")
    .filter((line) => /^\s+at\s/.test(line))
    .slice(0, MAX_STACK_FRAMES);

  return frames.length ? `\n${frames.join("\n")}` : "";
}

/**
 * Ошибка разбора JSON, у которой `message` нельзя печатать.
 *
 * V8 (Node 20+) вставляет в текст фрагмент разбираемой строки: `JSON.parse` на
 * `{"text": секрет}` даёт message `Unexpected token 'с', "{"text": секрет}" is
 * not valid JSON`. Через `express.json()` это ровно тело запроса пользователя.
 */
function isParseFailure(err: unknown, e: Record<string, unknown>): boolean {
  return err instanceof SyntaxError || e.type === "entity.parse.failed";
}

export function describeError(err: unknown): string {
  // Не-объекты (строка, число, undefined) — сами себе описание.
  if (err === null || typeof err !== "object") return String(err);

  const e = err as Record<string, unknown>;
  const message = typeof e.message === "string" ? e.message : "";
  const parseFailure = isParseFailure(err, e);

  // Объект без message описать нечем; сериализовать его целиком нельзя, потому
  // что именно там и прячется пользовательский контент.
  if (!message && !parseFailure) return String(err);

  const name = typeof e.name === "string" && e.name ? e.name : "Error";
  // У ошибки разбора вместо message — только имя и коды: для понимания «клиент
  // прислал битый JSON» этого хватает, а тела запроса в логе быть не должно.
  const parts = parseFailure ? [name] : [`${name}: ${message}`];

  if (parseFailure && isScalar(e.type)) parts.push(`type=${e.type}`);

  const status = e.status ?? e.statusCode;
  if (isScalar(status)) parts.push(`status=${status}`);
  if (isScalar(e.code)) parts.push(`code=${e.code}`);
  if (isScalar(e.error_code)) parts.push(`error_code=${e.error_code}`);

  return parts.join(" ") + stackFrames(err);
}
