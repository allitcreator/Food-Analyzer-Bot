/**
 * Синтетический Telegram-Update для быстрой записи с телефона.
 *
 * `POST /api/quick` не дублирует цепочку распознавания, а подсовывает боту
 * сообщение, как будто пользователь написал сам, — см. `injectUserMessage`
 * в `server/bot.ts`. Здесь живёт только сборка объекта: это чистая, env-free
 * функция (ровно как `validateInitData` рядом), поэтому форму апдейта —
 * единственное, чем мы завязаны на внутренности `node-telegram-bot-api`, —
 * можно проверить юнит-тестом без бота, сети и базы.
 */

export type SyntheticPayload = {
  text?: string;
  photoFileId?: string;
  caption?: string;
};

// message_id/update_id реальных сообщений выдаёт Telegram; для синтетических
// это делаем мы. Значения ни с чем не сверяются — важна только монотонность
// в пределах процесса, чтобы записи в логах не выглядели одинаковыми.
let seq = 0;
function nextId(): number {
  seq = (seq + 1) % 1_000_000;
  return (Date.now() % 1_000_000_000) + seq;
}

/**
 * Собрать Update с сообщением от лица пользователя.
 *
 * Поля — минимально необходимый набор, который читают хендлеры бота:
 * `from.id`, `chat.id` и `text` / `photo` / `caption`.
 *
 * @returns null, если telegramId не число или payload пуст.
 */
export function buildSyntheticUpdate(
  telegramId: string,
  payload: SyntheticPayload,
): Record<string, unknown> | null {
  // Number("") === 0, а пустой id не должен превращаться в валидный чат.
  const id = telegramId.trim() ? Number(telegramId) : NaN;
  if (!Number.isInteger(id) || id === 0) return null;

  const message: Record<string, unknown> = {
    message_id: nextId(),
    date: Math.floor(Date.now() / 1000),
    chat: { id, type: "private" },
    from: { id, is_bot: false, first_name: "quick" },
  };

  if (payload.photoFileId) {
    // Массив размеров: хендлер берёт последний элемент как самый крупный.
    message.photo = [{
      file_id: payload.photoFileId,
      file_unique_id: payload.photoFileId.slice(0, 16),
      width: 0,
      height: 0,
    }];
    if (payload.caption) message.caption = payload.caption;
  } else if (payload.text) {
    message.text = payload.text;
  } else {
    return null;
  }

  return { update_id: nextId(), message };
}
