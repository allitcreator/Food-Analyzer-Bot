/**
 * Выбор моделей по ролям и параметры запроса под семейство модели.
 * Чистые функции из server/lib/ai-models.ts, без сети и конфига.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_AI_MODELS,
  resolveAIModels,
  modelRequestParams,
  supportsTemperature,
  reasoningFor,
  withFallback,
} from "../server/lib/ai-models";

describe("resolveAIModels", () => {
  test("пустое окружение — текущие модели, fallback выключен", () => {
    const { primary, fallback } = resolveAIModels({});
    assert.deepEqual(primary, {
      vision: "openai/gpt-4o",
      // Штрихкод исторически читала mini-модель — без env так и остаётся.
      barcode: "openai/gpt-4o-mini",
      text: "openai/gpt-4o-mini",
      chat: "openai/gpt-4o-mini",
      audio: "google/gemini-3-flash-preview",
    });
    assert.deepEqual(primary, DEFAULT_AI_MODELS);
    assert.deepEqual(fallback, { vision: undefined, barcode: undefined, text: undefined, chat: undefined, audio: undefined });
  });

  test("штрихкод: AI_MODEL_BARCODE, иначе AI_MODEL_VISION, иначе gpt-4o-mini; fallback так же", () => {
    assert.equal(resolveAIModels({ AI_MODEL_VISION: "openai/gpt-6-luna" }).primary.barcode, "openai/gpt-6-luna");
    assert.equal(resolveAIModels({ AI_MODEL_VISION: "a/b", AI_MODEL_BARCODE: "c/d" }).primary.barcode, "c/d");
    assert.equal(resolveAIModels({ AI_FALLBACK_VISION: "x/y" }).fallback.barcode, "x/y");
  });

  test("переменные окружения переопределяют роли по отдельности, пробелы обрезаются", () => {
    const { primary, fallback } = resolveAIModels({
      AI_MODEL_VISION: " openai/gpt-6-luna ",
      AI_MODEL_AUDIO: "google/gemini-3.6-flash",
      AI_FALLBACK_TEXT: "anthropic/claude-haiku-5.5",
      AI_FALLBACK_CHAT: "",
    });
    assert.equal(primary.vision, "openai/gpt-6-luna");
    assert.equal(primary.text, "openai/gpt-4o-mini");
    assert.equal(primary.audio, "google/gemini-3.6-flash");
    assert.equal(fallback.text, "anthropic/claude-haiku-5.5");
    assert.equal(fallback.chat, undefined);
  });

  test("AI_REASONING_EFFORT принимает только известные значения", () => {
    assert.equal(resolveAIModels({ AI_REASONING_EFFORT: "low" }).reasoningEffort, "low");
    assert.equal(resolveAIModels({ AI_REASONING_EFFORT: "turbo" }).reasoningEffort, undefined);
    assert.equal(resolveAIModels({}).reasoningEffort, undefined);
  });
});

describe("supportsTemperature", () => {
  for (const m of ["openai/gpt-4o", "openai/gpt-4o-mini", "anthropic/claude-haiku-5.5", "google/gemini-3.6-flash"]) {
    test(`${m} — да`, () => assert.equal(supportsTemperature(m), true));
  }
  for (const m of ["openai/gpt-5", "openai/gpt-5-mini", "openai/gpt-5.1", "openai/gpt-6-luna", "openai/o3", "openai/o4-mini", "openai/o1"]) {
    test(`${m} — нет`, () => assert.equal(supportsTemperature(m), false));
  }
});

describe("reasoningFor", () => {
  test("не reasoning-модели и текущие дефолты — без параметра", () => {
    for (const m of ["openai/gpt-4o", "openai/gpt-4o-mini", "google/gemini-3-flash-preview", "anthropic/claude-3.5-haiku", "anthropic/claude-sonnet-4", "google/gemini-2.0-flash-001", "meta-llama/llama-4"]) {
      assert.equal(reasoningFor(m), undefined, m);
    }
  });

  test("GPT-5.1+/6 и Claude 4.5+/5 — reasoning выключен", () => {
    for (const m of ["openai/gpt-6-luna", "openai/gpt-5.1", "openai/gpt-5.2-mini", "anthropic/claude-haiku-5.5", "anthropic/claude-haiku-4.5", "anthropic/claude-sonnet-4.5", "anthropic/claude-opus-5"]) {
      assert.deepEqual(reasoningFor(m), { effort: "none" }, m);
    }
  });

  test("модели, которым нельзя выключить reasoning — минимально возможный уровень", () => {
    assert.deepEqual(reasoningFor("openai/gpt-5"), { effort: "minimal" });
    assert.deepEqual(reasoningFor("openai/gpt-5-mini"), { effort: "minimal" });
    assert.deepEqual(reasoningFor("openai/o4-mini"), { effort: "low" });
    assert.deepEqual(reasoningFor("google/gemini-3.6-flash"), { effort: "minimal" });
    assert.deepEqual(reasoningFor("google/gemini-3.5-flash-lite"), { effort: "minimal" });
    assert.deepEqual(reasoningFor("google/gemini-3-pro-preview"), { effort: "low" });
    assert.deepEqual(reasoningFor("google/gemini-2.5-pro"), { effort: "low" });
    assert.deepEqual(reasoningFor("google/gemini-2.5-flash"), { effort: "none" });
  });

  test("gpt-5-chat не reasoning, gpt-5-pro принимает только high — параметр не шлём", () => {
    assert.equal(reasoningFor("openai/gpt-5-chat"), undefined);
    assert.equal(reasoningFor("openai/gpt-5-pro"), undefined);
    assert.equal(reasoningFor("openai/gpt-5.1-chat"), undefined);
  });

  test("AI_REASONING_EFFORT не опускается ниже минимума модели", () => {
    // "none" для модели, которой reasoning не выключить, дал бы 400 на каждый запрос.
    assert.deepEqual(reasoningFor("google/gemini-3.6-flash", "none"), { effort: "minimal" });
    assert.deepEqual(reasoningFor("openai/o4-mini", "minimal"), { effort: "low" });
    assert.deepEqual(reasoningFor("openai/gpt-5-mini", "none"), { effort: "minimal" });
    assert.deepEqual(reasoningFor("google/gemini-3-flash-preview", "none"), { effort: "minimal" });
    assert.deepEqual(reasoningFor("anthropic/claude-haiku-5.5", "medium"), { effort: "medium" });
  });

  test("явный AI_REASONING_EFFORT перекрывает таблицу, но только для reasoning-моделей", () => {
    assert.deepEqual(reasoningFor("openai/gpt-6-luna", "low"), { effort: "low" });
    assert.equal(reasoningFor("openai/gpt-4o-mini", "low"), undefined);
    // Текущая аудио-модель по умолчанию шлётся как есть, но env может явно
    // включить ей минимальный reasoning — без правки кода.
    assert.deepEqual(reasoningFor("google/gemini-3-flash-preview", "minimal"), { effort: "minimal" });
  });
});

describe("modelRequestParams", () => {
  const base = {
    model: "ignored",
    temperature: 0.3,
    max_tokens: 1024,
    messages: [{ role: "user" as const, content: "x" }],
    response_format: { type: "json_object" as const },
  };

  test("текущие дефолты: запрос не меняется, кроме подстановки модели", () => {
    for (const m of Object.values(DEFAULT_AI_MODELS)) {
      assert.deepEqual(modelRequestParams(m, base), { ...base, model: m });
    }
  });

  test("GPT-6: без temperature, reasoning выключен, max_tokens на месте", () => {
    const out = modelRequestParams("openai/gpt-6-luna", base);
    assert.equal("temperature" in out, false);
    assert.equal(out.max_tokens, 1024);
    assert.deepEqual((out as any).reasoning, { effort: "none" });
    assert.deepEqual(out.response_format, { type: "json_object" });
  });

  test("Claude: temperature сохраняется, reasoning выключен", () => {
    const out = modelRequestParams("anthropic/claude-haiku-5.5", base);
    assert.equal(out.temperature, 0.3);
    assert.deepEqual((out as any).reasoning, { effort: "none" });
  });

  test("reasoning не выключен — к max_tokens добавляется запас, иначе короткие ответы съест reasoning", () => {
    const small = { model: "x", max_tokens: 50, messages: base.messages };
    assert.equal(modelRequestParams("google/gemini-3.6-flash", small).max_tokens, 50 + 1024);
    assert.equal(modelRequestParams("openai/o4-mini", small).max_tokens, 50 + 1024);
    assert.equal(modelRequestParams("openai/gpt-6-luna", small).max_tokens, 50);
    assert.equal(modelRequestParams("anthropic/claude-haiku-5.5", small, "low").max_tokens, 50 + 1024);
    // Без max_tokens ничего не добавляем.
    assert.equal("max_tokens" in modelRequestParams("google/gemini-3.6-flash", { model: "x", messages: base.messages }), false);
  });

  test("исходный объект не мутируется", () => {
    const copy = structuredClone(base);
    modelRequestParams("openai/gpt-6-luna", base);
    assert.deepEqual(base, copy);
  });
});

describe("withFallback", () => {
  test("основной успешен — fallback не зовётся", async () => {
    let calls = 0;
    const out = await withFallback(async () => "a", async () => { calls++; return "b"; });
    assert.equal(out, "a");
    assert.equal(calls, 0);
  });

  test("основной упал — один вызов fallback и колбэк с ошибкой", async () => {
    const seen: unknown[] = [];
    const out = await withFallback(
      async () => { throw new Error("primary"); },
      async () => "b",
      (err) => seen.push(err),
    );
    assert.equal(out, "b");
    assert.equal(seen.length, 1);
  });

  test("fallback не задан — исходная ошибка пробрасывается", async () => {
    await assert.rejects(withFallback(async () => { throw new Error("primary"); }, undefined), /primary/);
  });

  test("упал и fallback — пробрасывается ошибка fallback", async () => {
    await assert.rejects(
      withFallback(async () => { throw new Error("primary"); }, async () => { throw new Error("second"); }),
      /second/,
    );
  });
});
