/** Понятный текст ошибки запроса для тоста. `fallback` — что именно не удалось. */
import { ApiError } from "./api";

export function describeError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.reason === "timeout") return "Сервер не ответил вовремя, попробуйте ещё раз";
    if (err.reason === "network") return "Нет соединения с сервером";
    if (err.status === 429) return "Слишком часто — подождите минуту";
    if (err.status === 400) return `${fallback}: проверьте значения`;
    return fallback;
  }
  // fetch бросает TypeError при обрыве сети.
  if (err instanceof TypeError) return "Нет соединения с сервером";
  return fallback;
}
