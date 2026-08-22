/**
 * Разбор заголовка авторизации быстрой записи (`POST /api/quick`).
 *
 * Отдельный env-free модуль — как `validateInitData` рядом: чтобы функцию
 * можно было покрыть юнит-тестом, не поднимая storage, конфиг и бот.
 */

/**
 * `Authorization: Bearer <token>` → токен, иначе null.
 *
 * Алфавит ограничен намеренно: токен генерится как hex (`randomBytes(24)`),
 * а строгий паттерн отсекает мусор до похода в базу.
 */
export function extractBearerToken(header: unknown): string | null {
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+([A-Za-z0-9_-]{16,128})$/.exec(header.trim());
  return match ? match[1] : null;
}
