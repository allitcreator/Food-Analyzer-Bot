/**
 * Снапшот запросов к OpenRouter: что именно уходит в API из каждой функции
 * server/openai.ts при дефолтной конфигурации.
 *
 * Это гарантия «модели в env без изменения поведения»: пока переменные
 * AI_MODEL_* не заданы, тело запроса (модель, temperature, max_tokens,
 * response_format, форма сообщений) должно совпадать с тем, что бот отправлял
 * до выноса моделей в конфиг. Сеть не трогаем — подменяем globalThis.fetch до
 * импорта модуля, OpenAI SDK берёт fetch при создании клиента.
 *
 * Второй блок — fallback: основная модель окончательно упала → один повтор на
 * AI_FALLBACK_* модели.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN ??= "test-token";
process.env.OPENROUTER_API_KEY = "test-key";
process.env.DATABASE_URL ??= "postgres://test/test";
for (const key of Object.keys(process.env)) {
  if (key.startsWith("AI_MODEL_") || key.startsWith("AI_FALLBACK_") || key === "AI_REASONING_EFFORT") {
    delete process.env[key];
  }
}

type Captured = Record<string, any>;
const requests: Captured[] = [];
// Ответ по умолчанию; тест может подменить поведение по модели.
let failModels = new Set<string>();

function replyFor(body: Captured): Response {
  if (failModels.has(body.model)) {
    return new Response(JSON.stringify({ error: { message: "model gone", code: 400 } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const content = body.response_format ? '{"items":[],"intent":"food"}' : "ok";
  return new Response(
    JSON.stringify({
      id: "x",
      object: "chat.completion",
      created: 0,
      model: body.model,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

globalThis.fetch = (async (_url: any, init: any) => {
  const body = JSON.parse(String(init?.body ?? "{}"));
  requests.push(body);
  return replyFor(body);
}) as typeof fetch;

// Глушим служебные логи ретраев/fallback, чтобы не шуметь в выводе тестов.
console.error = () => {};
console.log = () => {};

const ai = await import("../server/openai");

/** Всё, кроме текстов промптов: модель, параметры, форма сообщений. */
function shape(body: Captured) {
  const { messages, ...rest } = body;
  return {
    ...rest,
    messages: (messages as any[]).map((m) => ({
      role: m.role,
      content: Array.isArray(m.content)
        ? m.content.map((p: any) => (p.type === "image_url" ? `image_url:${String(p.image_url.url).slice(0, 16)}` : p.type))
        : typeof m.content,
    })),
  };
}

async function capture(fn: () => Promise<unknown>): Promise<Captured[]> {
  requests.length = 0;
  await fn();
  return requests.map(shape);
}

const NOW = new Date(2026, 9, 26, 13, 0);
const day = { dayLabel: "Пн", calories: 1, protein: 1, fat: 1, carbs: 1 };

describe("снапшот запросов при дефолтных моделях", () => {
  beforeEach(() => { failModels = new Set(); });

  const cases: [string, () => Promise<unknown>, Captured][] = [
    ["analyzeFoodText", () => ai.analyzeFoodText("x", NOW), {
      model: "openai/gpt-4o-mini", max_tokens: 2048, response_format: { type: "json_object" },
      messages: [{ role: "system", content: "string" }, { role: "user", content: "string" }],
    }],
    ["classifyIntent", () => ai.classifyIntent("x"), {
      model: "openai/gpt-4o-mini", max_tokens: 50, response_format: { type: "json_object" },
      messages: [{ role: "system", content: "string" }, { role: "user", content: "string" }],
    }],
    ["analyzeWorkout", () => ai.analyzeWorkout("x", 70), {
      model: "openai/gpt-4o-mini", max_tokens: 256, response_format: { type: "json_object" },
      messages: [{ role: "system", content: "string" }, { role: "user", content: "string" }],
    }],
    ["generateEveningReport", () => ai.generateEveningReport([], { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0, sodium: 0 }, {}, [], null), {
      model: "openai/gpt-4o-mini", temperature: 0.3, max_tokens: 1024,
      messages: [{ role: "system", content: "string" }, { role: "user", content: "string" }],
    }],
    ["generatePeriodAnalysis", () => ai.generatePeriodAnalysis({
      period: "week", dailyStats: [day], avgCalories: 0, avgProtein: 0, avgFat: 0, avgCarbs: 0,
      topFoods: [], totalCaloriesBurned: 0, workoutTypes: [], weightStart: null, weightEnd: null, user: {},
    }), {
      model: "openai/gpt-4o-mini", temperature: 0.3, max_tokens: 1024,
      messages: [{ role: "system", content: "string" }, { role: "user", content: "string" }],
    }],
    ["transcribeVoice", () => ai.transcribeVoice(Buffer.from("OggS"), 5), {
      model: "google/gemini-3-flash-preview", max_tokens: 4096,
      messages: [{ role: "user", content: ["image_url:data:audio/ogg;b", "text"] }],
    }],
    ["detectBarcode", () => ai.detectBarcode("AAAA"), {
      model: "openai/gpt-4o-mini", max_tokens: 30,
      messages: [{ role: "user", content: ["text", "image_url:data:image/jpeg;"] }],
    }],
    ["askCoach", () => ai.askCoach("x", {}, [], { calories: 0, protein: 0, fat: 0, carbs: 0 }), {
      model: "openai/gpt-4o-mini", max_tokens: 1024,
      messages: [{ role: "system", content: "string" }, { role: "user", content: "string" }],
    }],
    ["generateWeightAnalysis", () => ai.generateWeightAnalysis([], [day], {}), {
      model: "openai/gpt-4o-mini", temperature: 0.3, max_tokens: 1024,
      messages: [{ role: "system", content: "string" }, { role: "user", content: "string" }],
    }],
    ["analyzeFoodImage", () => ai.analyzeFoodImage("AAAA", NOW), {
      model: "openai/gpt-4o", temperature: 0, max_tokens: 1024, response_format: { type: "json_object" },
      messages: [{ role: "system", content: "string" }, { role: "user", content: ["text", "image_url:data:image/jpeg;"] }],
    }],
    ["groupFoodNames", () => ai.groupFoodNames(["a"]), {
      model: "openai/gpt-4o-mini", max_tokens: 2048, response_format: { type: "json_object" },
      messages: [{ role: "system", content: "string" }, { role: "user", content: "string" }],
    }],
  ];

  for (const [name, call, expected] of cases) {
    test(`${name}: тело запроса не изменилось`, async () => {
      const sent = await capture(call);
      assert.equal(sent.length, 1, `ожидался ровно один запрос, ушло ${sent.length}`);
      // deepEqual строгий: лишний ключ (reasoning, лишний temperature) — падение.
      assert.deepEqual(sent[0], expected);
    });
  }
});

describe("fallback-модель", () => {
  beforeEach(() => { failModels = new Set(); });

  test("основная модель окончательно упала — один запрос на fallback той же роли", async () => {
    const cfg = (await import("../server/config")).config;
    const prev = cfg.aiFallbackModels.text;
    cfg.aiFallbackModels.text = "anthropic/claude-haiku-5.5";
    failModels = new Set(["openai/gpt-4o-mini"]);
    try {
      requests.length = 0;
      const items = await ai.analyzeFoodText("x", NOW);
      const models = requests.map((r) => r.model);
      assert.deepEqual(models, ["openai/gpt-4o-mini", "anthropic/claude-haiku-5.5"]);
      // Параметры fallback считаются под его семейство: reasoning выключен.
      assert.deepEqual(requests[1].reasoning, { effort: "none" });
      assert.deepEqual(items, null); // ответ-заглушка с пустым items
    } finally {
      cfg.aiFallbackModels.text = prev;
    }
  });

  test("без fallback — только основная модель, ошибка как раньше", async () => {
    failModels = new Set(["openai/gpt-4o-mini"]);
    requests.length = 0;
    const result = await ai.classifyIntent("x");
    assert.equal(result, "food");
    assert.deepEqual(requests.map((r) => r.model), ["openai/gpt-4o-mini"]);
  });

  test("override модели роли из конфига подхватывается без рестарта", async () => {
    const cfg = (await import("../server/config")).config;
    const prev = cfg.aiModels.vision;
    cfg.aiModels.vision = "openai/gpt-6-luna";
    try {
      const sent = await capture(() => ai.analyzeFoodImage("AAAA", NOW));
      assert.equal(sent[0].model, "openai/gpt-6-luna");
      assert.equal("temperature" in sent[0], false, "GPT-6 не принимает temperature");
      assert.equal(sent[0].max_tokens, 1024);
    } finally {
      cfg.aiModels.vision = prev;
    }
  });
});
