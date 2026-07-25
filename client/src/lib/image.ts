/**
 * Клиентское сжатие фото еды в base64 (БЕЗ data:-префикса) для POST /analyze.
 *
 * nginx на проде режет тело запроса на 1 МБ, а express.json — на 2 МБ, поэтому
 * картинку обязательно ужимаем здесь: вписываем в квадрат по большей стороне и
 * кодируем в JPEG. Основной путь — createImageBitmap с коррекцией EXIF-ориентации
 * (телефон часто снимает «боком»); для старых WebView есть фолбэк через <img>.
 */

const MAX_SIDE = 1280;
const QUALITY = 0.8;
// Если результат всё ещё крупный (символы base64, не байты) — пережимаем жёстче.
const MAX_CHARS = 900_000;
const FALLBACK_SIDE = 1024;
const FALLBACK_QUALITY = 0.6;

/** Унифицированный декодированный источник: размеры + отрисовка на canvas. */
interface Decoded {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  close: () => void;
}

async function decodeImage(file: File): Promise<Decoded> {
  // Современный путь: createImageBitmap с автоповоротом по EXIF.
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
        close: () => bitmap.close(),
      };
    } catch {
      /* старые WebView без опций createImageBitmap — падаем на <img> */
    }
  }

  // Фолбэк: <img> + object URL.
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Не удалось прочитать изображение"));
      el.src = url;
    });
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
      close: () => URL.revokeObjectURL(url),
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/** Отрисовать в canvas нужного размера и вернуть base64 (без data:-префикса). */
function encode(decoded: Decoded, maxSide: number, quality: number): string {
  const scale = Math.min(1, maxSide / Math.max(decoded.width, decoded.height, 1));
  const w = Math.max(1, Math.round(decoded.width * scale));
  const h = Math.max(1, Math.round(decoded.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось обработать изображение");
  decoded.draw(ctx, w, h);

  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const comma = dataUrl.indexOf(",");
  if (comma < 0 || !dataUrl.startsWith("data:image/jpeg")) {
    throw new Error("Не удалось сжать изображение");
  }
  return dataUrl.slice(comma + 1);
}

/** Сжать выбранный файл в JPEG-base64, вписав в лимит по размеру. */
export async function compressImageToBase64(file: File): Promise<string> {
  const decoded = await decodeImage(file);
  try {
    let base64 = encode(decoded, MAX_SIDE, QUALITY);
    if (base64.length > MAX_CHARS) {
      base64 = encode(decoded, FALLBACK_SIDE, FALLBACK_QUALITY);
    }
    return base64;
  } finally {
    decoded.close();
  }
}
