/**
 * Приём фото бинарём — второй путь для `POST /api/quick`.
 *
 * Почему он появился: шорткат iOS стабильно отправлял пустой `imageBase64`.
 * Всё, что в нём работает, — короткие строки (токен, подпись); не работала
 * ровно одна гигантская, на 300+ КБ. Режим «тело запроса = файл» убирает и
 * кодирование, и саму строку: снимок уходит как есть.
 *
 * Правила проверки повторяют JSON-путь (пустота, размер, длина подписи), но
 * снимок не перекодируется: буфер уходит в `sendPhoto` как есть.
 *
 * Подпись едет в query: тело занято файлом, а заголовок для кириллицы —
 * плохое место (её пришлось бы кодировать вручную на стороне шортката).
 */
import { z } from "zod";

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

/** Максимум для снимка в байтах — согласован с nginx (`client_max_body_size 8m`). */
const MAX_PHOTO_BYTES = 8_000_000;

/** Подпись из query: те же правила, что у `text` в JSON-теле. */
const captionSchema = z
  .string()
  .trim()
  .max(2000)
  .transform((s) => s || undefined)
  .optional();

/**
 * Разобрать бинарный запрос, не перекодируя снимок.
 *
 * Раньше байты гонялись в base64, чтобы пройти общий `quickSchema`, а отправка
 * декодировала их обратно. На кадре в 4 МБ это лишние ~9 МБ на пике без всякой
 * пользы: в Telegram уезжают ровно те же исходные байты. Поэтому буфер
 * проходит проверку как есть, а правила для подписи повторяют JSON-путь.
 */
export function binaryQuickBody(
  buffer: Buffer,
  query: Record<string, unknown>,
): { success: true; data: { photo: Buffer; text?: string } } | { success: false; error: string; data?: undefined } {
  if (buffer.length === 0) return { success: false, error: "empty_body" };
  if (buffer.length > MAX_PHOTO_BYTES) return { success: false, error: "photo_too_big" };

  const caption = captionSchema.safeParse(firstString(query.text) ?? undefined);
  if (!caption.success) return { success: false, error: "invalid_caption" };

  return { success: true, data: { photo: buffer, text: caption.data } };
}
