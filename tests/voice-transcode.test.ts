/**
 * Голос из Mini App: перекодирование в OGG/Opus и проверка длительности
 * (server/lib/voice-transcode.ts) на настоящем ffmpeg. Тестовые записи
 * генерирует сам ffmpeg (синус). Без ffmpeg в PATH тесты пропускаются.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareVoice, inputExtension, inputFormat, createTranscodeSlots } from "../server/lib/voice-transcode";

const execFileAsync = promisify(execFile);

function hasFfmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const skip = hasFfmpeg() ? false : "ffmpeg/ffprobe не установлены";

/** Синус заданной длины в нужном контейнере. */
async function makeAudio(seconds: number, ext: "webm" | "m4a" | "wav"): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "voice-test-"));
  try {
    const out = path.join(dir, `a.${ext}`);
    const codec = ext === "webm" ? ["-c:a", "libopus"] : ext === "m4a" ? ["-c:a", "aac"] : [];
    await execFileAsync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, ...codec, out]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Временные каталоги prepareVoice — их не должно остаться. */
async function leftovers(): Promise<string[]> {
  return (await readdir(tmpdir())).filter((n) => n.startsWith("miniapp-voice-"));
}

describe("inputExtension", () => {
  test("по MIME", () => {
    assert.equal(inputExtension("audio/webm;codecs=opus"), "webm");
    assert.equal(inputExtension("audio/ogg"), "ogg");
    assert.equal(inputExtension("audio/mp4"), "m4a");
    assert.equal(inputExtension("audio/mpeg"), "mp3");
    assert.equal(inputExtension("audio/x-something"), "bin");
  });
});

describe("inputFormat", () => {
  test("демуксер ffmpeg по MIME, неизвестное — null", () => {
    assert.equal(inputFormat("audio/webm;codecs=opus"), "matroska");
    assert.equal(inputFormat("audio/mp4"), "mov");
    assert.equal(inputFormat("audio/x-m4a"), "mov");
    assert.equal(inputFormat("audio/ogg;codecs=opus"), "ogg");
    assert.equal(inputFormat("audio/mpeg"), "mp3");
    assert.equal(inputFormat("audio/wav"), "wav");
    assert.equal(inputFormat("audio/x-something"), null);
  });
});

describe("createTranscodeSlots", () => {
  test("не больше max одновременно, release освобождает место", () => {
    const slots = createTranscodeSlots(2);
    assert.equal(slots.tryAcquire(), true);
    assert.equal(slots.tryAcquire(), true);
    assert.equal(slots.tryAcquire(), false);
    slots.release();
    assert.equal(slots.tryAcquire(), true);
  });
});

describe("prepareVoice без ffmpeg", () => {
  test("все слоты заняты → busy сразу, чужой слот не освобождается", async () => {
    const slots = createTranscodeSlots(1);
    assert.equal(slots.tryAcquire(), true);
    const r = await prepareVoice(Buffer.from("x"), "audio/ogg", 60, { slots });
    assert.deepEqual(r, { ok: false, reason: "busy" });
    assert.equal(slots.tryAcquire(), false, "занятый слот должен остаться занятым");
  });

  test("неизвестный формат → invalid без запуска ffmpeg", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const r = await prepareVoice(Buffer.from("x"), "audio/x-something", 60);
      assert.deepEqual(r, { ok: false, reason: "invalid" });
    } finally {
      console.error = origError;
    }
  });
});

describe("prepareVoice", { skip }, () => {
  test("webm 2 с → ogg/opus, длительность ~2 с, временные файлы удалены", async () => {
    const before = await leftovers();
    const r = await prepareVoice(await makeAudio(2, "webm"), "audio/webm;codecs=opus");
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.audio.subarray(0, 4).toString("latin1"), "OggS");
    assert.ok(r.durationSec !== null && Math.abs(r.durationSec - 2) < 0.5, String(r.durationSec));
    assert.deepEqual(await leftovers(), before);
  });

  test("mp4/aac (Safari) тоже перекодируется", async () => {
    const r = await prepareVoice(await makeAudio(1, "m4a"), "audio/mp4");
    assert.ok(r.ok);
  });

  test("длиннее лимита → too_long", async () => {
    const r = await prepareVoice(await makeAudio(5, "webm"), "audio/webm", 3);
    assert.deepEqual(r, { ok: false, reason: "too_long" });
  });

  test("не аудио → invalid, временные файлы удалены", async () => {
    const before = await leftovers();
    const origError = console.error;
    console.error = () => {};
    try {
      const r = await prepareVoice(Buffer.from("это не аудио"), "audio/ogg");
      assert.deepEqual(r, { ok: false, reason: "invalid" });
    } finally {
      console.error = origError;
    }
    assert.deepEqual(await leftovers(), before);
  });

  test("wav перекодируется", async () => {
    const r = await prepareVoice(await makeAudio(1, "wav"), "audio/wav");
    assert.ok(r.ok, JSON.stringify(r));
  });

  test("webm под видом mp4 → invalid: формат задаём явно, а не угадываем", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const r = await prepareVoice(await makeAudio(1, "webm"), "audio/mp4");
      assert.deepEqual(r, { ok: false, reason: "invalid" });
    } finally {
      console.error = origError;
    }
  });

  test("запись чуть длиннее лимита (60.05 с при лимите 60) → ok: дробные секунды не считаем", async () => {
    const r = await prepareVoice(await makeAudio(60.05, "webm"), "audio/webm;codecs=opus");
    assert.ok(r.ok, JSON.stringify(r));
  });

  test("слот освобождается и после успеха, и после ошибки", async () => {
    const slots = createTranscodeSlots(1);
    const origError = console.error;
    console.error = () => {};
    try {
      assert.deepEqual(await prepareVoice(Buffer.from("не аудио"), "audio/ogg", 60, { slots }), { ok: false, reason: "invalid" });
    } finally {
      console.error = origError;
    }
    const r = await prepareVoice(await makeAudio(1, "webm"), "audio/webm", 60, { slots });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(slots.tryAcquire(), true);
  });

  test("бюджет времени исчерпан → invalid, временные файлы удалены", async () => {
    const audio = await makeAudio(2, "webm");
    const before = await leftovers();
    const origError = console.error;
    console.error = () => {};
    try {
      const r = await prepareVoice(audio, "audio/webm", 60, { budgetMs: 1 });
      assert.deepEqual(r, { ok: false, reason: "invalid" });
    } finally {
      console.error = origError;
    }
    assert.deepEqual(await leftovers(), before);
  });
});
