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

/**
 * Формат картинки по сигнатуре первых байт.
 *
 * Нужен, потому что снимок теперь едет без конвертации, а iPhone по умолчанию
 * снимает в HEIC — Telegram такой файл не принимает. Без этой проверки отказ
 * прилетел бы из `sendPhoto` и выглядел бы как «опять ничего не пришло».
 */
export function detectImageKind(buffer: Buffer): "jpeg" | "png" | "heic" | "unknown" {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  // HEIC/HEIF: контейнер ISO-BMFF, бренд лежит в боксе ftyp сразу после длины.
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii");
    if (brand.startsWith("hei") || brand.startsWith("mif") || brand.startsWith("msf")) return "heic";
  }
  return "unknown";
}

/**
 * Считать ли тело бинарным.
 *
 * Правило от противного: JSON забирает `express.json`, всё остальное читаем
 * как байты. Перечислять типы картинок бесполезно — первый прогон бинарной
 * отправки дал `body=undefined`, то есть шорткат прислал что-то, чего в
 * списке `image/*` не оказалось, и запрос остался вообще без тела.
 */
export function isBinaryContentType(contentType: string | undefined): boolean {
  if (!contentType) return true;
  return !contentType.toLowerCase().trimStart().startsWith("application/json");
}

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
