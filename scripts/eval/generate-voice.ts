/**
 * Генерирует синтетические голосовые для eval из eval/voice/phrases.json:
 * macOS `say` (русский голос) → AIFF → ffmpeg → OGG/Opus mono 48 кГц, как
 * голосовые Telegram. Пишет eval/voice/<id>.ogg и eval/voice/manifest.json
 * с длительностью и эталонными расшифровками.
 *
 * Запуск: npx tsx scripts/eval/generate-voice.ts
 * Нужны: macOS `say` с голосом из phrases.json (по умолчанию Milena),
 * ffmpeg с libopus, ffprobe.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VOICE_DIR = path.join(ROOT, "eval", "voice");

interface Phrase { id: string; text: string; references?: string[]; rate?: number; pauseMs?: number }

async function ensureTools(voice: string) {
  try {
    await run("which", ["ffmpeg"]);
    await run("which", ["ffprobe"]);
  } catch {
    throw new Error("Нужны ffmpeg и ffprobe (brew install ffmpeg).");
  }
  let voices = "";
  try {
    voices = (await run("say", ["-v", "?"])).stdout;
  } catch {
    throw new Error("Нужна macOS-утилита `say`. На Linux запишите голосовые сами (см. eval/README.md).");
  }
  if (!voices.split("\n").some((l) => l.startsWith(voice + " "))) {
    throw new Error(`Голос ${voice} не установлен: Системные настройки → Универсальный доступ → Устная речь → Системный голос → Управление голосами.`);
  }
}

async function main() {
  const src = JSON.parse(await readFile(path.join(VOICE_DIR, "phrases.json"), "utf8")) as { voice: string; phrases: Phrase[] };
  await ensureTools(src.voice);
  const tmp = await mkdtemp(path.join(tmpdir(), "eval-voice-"));
  const manifest: { id: string; file: string; durationSec: number; references: string[] }[] = [];
  try {
    for (const p of src.phrases) {
      const textFile = path.join(tmp, `${p.id}.txt`);
      const aiff = path.join(tmp, `${p.id}.aiff`);
      const ogg = path.join(VOICE_DIR, `${p.id}.ogg`);
      // [[slnc N]] — встроенная команда `say`: пауза N мс. Только в аудио,
      // в эталон расшифровки не попадает.
      const spoken = p.pauseMs ? p.text.replace(/([.!?])\s+/g, `$1 [[slnc ${p.pauseMs}]] `) : p.text;
      await writeFile(textFile, spoken, "utf8");
      const sayArgs = ["-v", src.voice, "-o", aiff, "-f", textFile];
      if (p.rate) sayArgs.push("-r", String(p.rate));
      await run("say", sayArgs);
      await run("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "32k", "-application", "voip", ogg]);
      const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", ogg]);
      const durationSec = Math.round(parseFloat(stdout.trim()) * 10) / 10;
      manifest.push({ id: p.id, file: `${p.id}.ogg`, durationSec, references: [p.text, ...(p.references ?? [])] });
      console.log(`${p.id}: ${durationSec} с`);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  await writeFile(path.join(VOICE_DIR, "manifest.json"), JSON.stringify({ generatedBy: "scripts/eval/generate-voice.ts", items: manifest }, null, 1) + "\n");
  const long = manifest.filter((m) => m.durationSec > 60).length;
  console.log(`Готово: ${manifest.length} файлов, длиннее 60 с — ${long}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
