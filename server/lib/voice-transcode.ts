/**
 * Голос из Mini App → OGG/Opus для расшифровки.
 *
 * Браузер пишет то, что умеет: Chrome/Android — webm/opus, Safari/iOS — mp4/aac.
 * Модель расшифровки ждёт ogg (как голосовые Telegram), поэтому перекодируем
 * ffmpeg'ом и заодно меряем длительность. У webm из MediaRecorder длительности
 * в контейнере часто нет, поэтому окончательно меряем уже готовый ogg, а
 * перекодирование обрезаем чуть дальше лимита (`-t`), чтобы длинная запись не
 * тратила время целиком.
 *
 * ffmpeg/ffprobe запускаются через execFile (без shell), во временном каталоге,
 * который удаляется в finally. Содержимое аудио и вывод ffmpeg в лог не идут.
 * Входной формат задаётся явно (`-f`), протоколы ограничены файлами
 * (`-protocol_whitelist file`), ffmpeg работает в один поток. Одновременно идут
 * не больше MAX_CONCURRENT_TRANSCODES перекодирований, на запрос — общий
 * бюджет времени TRANSCODE_BUDGET_MS.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkVoiceDuration } from "./ai-quota";

/** Потолок для голоса из Mini App, секунд. */
export const MINIAPP_VOICE_MAX_SECONDS = 60;

/**
 * Общий бюджет времени на одну запись: оба ffprobe и ffmpeg вместе. Каждому
 * запуску достаётся остаток, а не свои 30 с.
 */
export const TRANSCODE_BUDGET_MS = 40_000;

/** Сколько перекодирований одновременно на процесс; сверх — сразу отказ. */
export const MAX_CONCURRENT_TRANSCODES = 2;

export type PreparedVoice =
  | { ok: true; audio: Buffer; durationSec: number | null }
  | { ok: false; reason: "too_long" }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "busy" };

/** Счётчик занятых слотов без очереди: занято — tryAcquire() отвечает false. */
export function createTranscodeSlots(max: number) {
  let active = 0;
  return {
    tryAcquire(): boolean {
      if (active >= max) return false;
      active++;
      return true;
    },
    release(): void {
      if (active > 0) active--;
    },
  };
}

export type TranscodeSlots = ReturnType<typeof createTranscodeSlots>;

const defaultSlots = createTranscodeSlots(MAX_CONCURRENT_TRANSCODES);

/** Расширение входного файла по MIME (имя временного файла). */
export function inputExtension(mimeType: string): string {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  if (base.includes("webm")) return "webm";
  if (base.includes("ogg") || base.includes("opus")) return "ogg";
  if (base.includes("mp4") || base.includes("m4a") || base.includes("aac")) return "m4a";
  if (base.includes("mpeg") || base.includes("mp3")) return "mp3";
  if (base.includes("wav")) return "wav";
  return "bin";
}

/**
 * Демуксер ffmpeg (`-f`) по тому же whitelist, что inputExtension. Формат
 * задаём явно, чтобы ffmpeg не угадывал его по содержимому и не открывал
 * экзотические демуксеры из присланных байтов. Неизвестный MIME → null.
 */
const DEMUXERS: Record<string, string> = {
  webm: "matroska",
  ogg: "ogg",
  m4a: "mov",
  mp3: "mp3",
  wav: "wav",
};

export function inputFormat(mimeType: string): string | null {
  return DEMUXERS[inputExtension(mimeType)] ?? null;
}

/**
 * Запуск ffmpeg/ffprobe без shell. stdin закрываем сразу (ffprobe не знает
 * `-nostdin`), таймаут — остаток общего бюджета; бюджет кончился — ошибка без
 * запуска.
 */
function run(cmd: string, args: string[], deadline: number): Promise<string> {
  const timeout = deadline - Date.now();
  if (timeout <= 0) return Promise.reject(Object.assign(new Error("transcode budget exceeded"), { code: "ETIMEDOUT" }));
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
    child.stdin?.end();
  });
}

/**
 * Длительность в целых секундах (вниз) или null, если ffprobe её не знает.
 * Округляем вниз, как у голосовых Telegram: запись с автостопом на 60 с
 * всегда чуть длиннее (60.02 с) и не должна получать too_long.
 */
async function probeDuration(file: string, format: string, deadline: number): Promise<number | null> {
  const stdout = await run(
    "ffprobe",
    [
      "-v", "error",
      "-protocol_whitelist", "file",
      "-f", format,
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      file,
    ],
    deadline,
  );
  const sec = parseFloat(stdout.trim());
  return Number.isFinite(sec) ? Math.floor(sec) : null;
}

/** Только код выхода: stderr ffmpeg пересказывает метаданные файла. */
function logFailure(err: unknown): void {
  const code = (err as { code?: unknown }).code;
  console.error(`[voice] ffmpeg failed: code=${String(code)}`);
}

/**
 * Перекодировать запись в OGG/Opus и проверить длительность.
 * `invalid` — ffmpeg не смог прочитать вход (битые или не аудио-данные,
 * неизвестный формат) или не уложился в бюджет времени.
 * `busy` — все слоты перекодирования заняты, ffmpeg не запускался.
 */
export async function prepareVoice(
  input: Buffer,
  mimeType: string,
  maxSec: number = MINIAPP_VOICE_MAX_SECONDS,
  opts: { slots?: TranscodeSlots; budgetMs?: number } = {},
): Promise<PreparedVoice> {
  const format = inputFormat(mimeType);
  if (!format) {
    console.error("[voice] unsupported input format");
    return { ok: false, reason: "invalid" };
  }

  const slots = opts.slots ?? defaultSlots;
  if (!slots.tryAcquire()) return { ok: false, reason: "busy" };
  try {
    const deadline = Date.now() + (opts.budgetMs ?? TRANSCODE_BUDGET_MS);
    const dir = await mkdtemp(path.join(tmpdir(), "miniapp-voice-"));
    try {
      const inPath = path.join(dir, `input.${inputExtension(mimeType)}`);
      const outPath = path.join(dir, "output.ogg");
      await writeFile(inPath, input);

      try {
        // Быстрый отказ, если длительность есть в контейнере.
        const inDuration = await probeDuration(inPath, format, deadline).catch(() => null);
        if (!checkVoiceDuration(inDuration ?? undefined, maxSec).ok) return { ok: false, reason: "too_long" };

        await run(
          "ffmpeg",
          [
            "-nostdin", "-y", "-v", "error",
            "-protocol_whitelist", "file",
            "-f", format,
            "-i", inPath,
            "-vn", "-t", String(maxSec + 1),
            "-threads", "1",
            "-c:a", "libopus", "-b:a", "32k",
            "-f", "ogg", outPath,
          ],
          deadline,
        );
      } catch (err) {
        logFailure(err);
        return { ok: false, reason: "invalid" };
      }

      let durationSec: number | null;
      try {
        durationSec = await probeDuration(outPath, "ogg", deadline);
      } catch (err) {
        // Без длительности результата не отдаём: бюджет кончился или ogg битый.
        logFailure(err);
        return { ok: false, reason: "invalid" };
      }
      if (!checkVoiceDuration(durationSec ?? undefined, maxSec).ok) return { ok: false, reason: "too_long" };
      return { ok: true, audio: await readFile(outPath), durationSec };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  } finally {
    slots.release();
  }
}
