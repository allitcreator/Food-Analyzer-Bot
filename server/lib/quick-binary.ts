/**
 * Приём фото бинарём — второй путь для `POST /api/quick`.
 *
 * Почему он появился: шорткат iOS стабильно отправлял пустой `imageBase64`.
 * Всё, что в нём работает, — короткие строки (токен, подпись); не работала
 * ровно одна гигантская, на 300+ КБ. Режим «тело запроса = файл» убирает и
 * кодирование, и саму строку: снимок уходит как есть.
 *
 * Контракт при этом не раздваивается. Бинарное тело приводится к тому же
 * объекту, что приезжает в JSON-варианте, и дальше проходит общий
 * `quickSchema` — правила про размер, пустоту и подпись остаются одни.
 *
 * Подпись едет в query: тело занято файлом, а заголовок для кириллицы —
 * плохое место (её пришлось бы кодировать вручную на стороне шортката).
 */

/** Разбор `?text=` — express отдаёт строку, массив или ничего. */
function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item) return item;
    }
  }
  return undefined;
}

export function bodyFromBinary(
  buffer: Buffer,
  query: Record<string, unknown>,
): { imageBase64?: string; text?: string } {
  const body: { imageBase64?: string; text?: string } = {};
  // Пустое тело не выдаём за картинку: пусть его отвергнет общая схема с
  // внятной ошибкой, а не «пустая строка не base64».
  if (buffer.length > 0) body.imageBase64 = buffer.toString("base64");

  const text = firstString(query.text);
  if (text) body.text = text;

  return body;
}
