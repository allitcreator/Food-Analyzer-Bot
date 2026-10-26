/**
 * Модели ИИ по ролям и параметры запроса под семейство модели.
 *
 * Роли:
 * - vision — фото еды (analyzeFoodImage);
 * - barcode — чтение штрихкода с фото (detectBarcode). Отдельная роль только
 *            ради дефолта: исторически это gpt-4o-mini, а не gpt-4o. Если
 *            AI_MODEL_BARCODE не задан, берётся AI_MODEL_VISION, а без него —
 *            gpt-4o-mini;
 * - text   — JSON-задачи по тексту (analyzeFoodText, classifyIntent,
 *            analyzeWorkout, groupFoodNames);
 * - chat   — свободный текст: отчёты, анализы, askCoach;
 * - audio  — расшифровка голосовых.
 *
 * Модуль чистый: окружение передаётся аргументом, сети и конфига нет.
 */

export type AIRole = "vision" | "barcode" | "text" | "chat" | "audio";
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";

export const DEFAULT_AI_MODELS: Record<AIRole, string> = {
  vision: "openai/gpt-4o",
  barcode: "openai/gpt-4o-mini",
  text: "openai/gpt-4o-mini",
  chat: "openai/gpt-4o-mini",
  audio: "google/gemini-3-flash-preview",
};

const ROLES: AIRole[] = ["vision", "barcode", "text", "chat", "audio"];
const EFFORTS: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high"];

export interface AIModelsConfig {
  primary: Record<AIRole, string>;
  fallback: Record<AIRole, string | undefined>;
  reasoningEffort: ReasoningEffort | undefined;
}

function envValue(env: Record<string, string | undefined>, name: string): string | undefined {
  const v = env[name]?.trim();
  return v ? v : undefined;
}

/** AI_MODEL_<ROLE>, AI_FALLBACK_<ROLE>, AI_REASONING_EFFORT. */
export function resolveAIModels(env: Record<string, string | undefined>): AIModelsConfig {
  const primary = {} as Record<AIRole, string>;
  const fallback = {} as Record<AIRole, string | undefined>;
  for (const role of ROLES) {
    const key = role.toUpperCase();
    primary[role] = envValue(env, `AI_MODEL_${key}`) ?? DEFAULT_AI_MODELS[role];
    fallback[role] = envValue(env, `AI_FALLBACK_${key}`);
  }
  primary.barcode = envValue(env, "AI_MODEL_BARCODE") ?? envValue(env, "AI_MODEL_VISION") ?? DEFAULT_AI_MODELS.barcode;
  fallback.barcode = envValue(env, "AI_FALLBACK_BARCODE") ?? envValue(env, "AI_FALLBACK_VISION");
  const effort = envValue(env, "AI_REASONING_EFFORT") as ReasoningEffort | undefined;
  return {
    primary,
    fallback,
    reasoningEffort: effort && EFFORTS.includes(effort) ? effort : undefined,
  };
}

/** Имя модели без провайдера: "openai/gpt-6-luna" → "gpt-6-luna". */
function bareName(modelId: string): { vendor: string; name: string } {
  const lower = modelId.toLowerCase();
  const slash = lower.indexOf("/");
  return slash === -1 ? { vendor: "", name: lower } : { vendor: lower.slice(0, slash), name: lower.slice(slash + 1) };
}

const OPENAI_O_SERIES = /^o\d/;
const OPENAI_GPT_REASONING = /^gpt-(\d+)(?:\.(\d+))?/;

/**
 * GPT-5+ и o-серия отклоняют `temperature` (кроме дефолтного 1), поэтому его
 * у них просто не шлём. Остальные семейства принимают.
 */
export function supportsTemperature(modelId: string): boolean {
  const { vendor, name } = bareName(modelId);
  if (vendor !== "openai") return true;
  if (OPENAI_O_SERIES.test(name)) return false;
  const m = OPENAI_GPT_REASONING.exec(name);
  return !(m && Number(m[1]) >= 5);
}

/**
 * Модели, которые шлём как раньше, без reasoning-параметра, хотя они
 * reasoning-модели. Сейчас это аудио-модель по умолчанию: гарантия «без
 * изменения поведения на проде». Включить ей reasoning-параметр можно через
 * AI_REASONING_EFFORT.
 */
const PASSTHROUGH = new Set(["google/gemini-3-flash-preview"]);

/**
 * Параметр `reasoning` в формате OpenRouter
 * (https://openrouter.ai/docs/use-cases/reasoning-tokens): `effort: "none"`
 * выключает reasoning целиком. Модели, у которых reasoning обязателен,
 * "none" отклоняют, им ставим минимальный поддерживаемый уровень.
 *
 * Возвращает undefined, если модель не reasoning — тогда параметр не шлём.
 */
export function reasoningFor(modelId: string, override?: ReasoningEffort): { effort: ReasoningEffort } | undefined {
  const minimum = reasoningTable(modelId);
  if (!minimum) return undefined;
  if (PASSTHROUGH.has(modelId.toLowerCase()) && !override) return undefined;
  // Override не опускаем ниже минимума модели: "none" там, где reasoning
  // обязателен, дал бы 400 на каждый запрос.
  const effort = override && EFFORTS.indexOf(override) > EFFORTS.indexOf(minimum) ? override : minimum;
  return { effort };
}

function reasoningTable(modelId: string): ReasoningEffort | undefined {
  const { vendor, name } = bareName(modelId);

  if (vendor === "openai") {
    // o1/o3/o4: выключить нельзя, low — нижний уровень у всей серии.
    if (OPENAI_O_SERIES.test(name)) return "low";
    const m = OPENAI_GPT_REASONING.exec(name);
    if (!m) return undefined;
    const major = Number(m[1]);
    const minor = m[2] === undefined ? 0 : Number(m[2]);
    if (major < 5) return undefined;
    // -chat — обычная модель без reasoning; -pro принимает только high, его
    // не трогаем (дорогая модель, для бота не кандидат).
    if (/-(chat|pro)\b/.test(name)) return undefined;
    // GPT-5 (gpt-5, -mini, -nano) знает только minimal; с GPT-5.1 есть none.
    if (major === 5 && minor === 0) return "minimal";
    return "none";
  }

  if (vendor === "anthropic") {
    // claude-haiku-4.5, claude-sonnet-4.5, claude-opus-5, claude-haiku-5.5 …
    const m = /^claude-[a-z]+-(\d+)(?:\.(\d+))?/.exec(name);
    if (!m) return undefined;
    const major = Number(m[1]);
    const minor = m[2] === undefined ? 0 : Number(m[2]);
    if (major > 4 || (major === 4 && minor >= 5)) return "none";
    return undefined;
  }

  if (vendor === "google") {
    const m = /^gemini-(\d+)(?:\.(\d+))?-?([a-z-]*)/.exec(name);
    if (!m) return undefined;
    const version = Number(m[1]) + (m[2] === undefined ? 0 : Number(`0.${m[2]}`));
    const variant = m[3] ?? "";
    if (version < 2.5) return undefined;
    // Pro-модели думают всегда; у Gemini 3 thinkingLevel не опускается ниже
    // minimal (OpenRouter мапит effort на thinkingLevel напрямую).
    if (variant.startsWith("pro")) return "low";
    if (version >= 3) return "minimal";
    return "none";
  }

  return undefined;
}

/** Запас к max_tokens, когда reasoning не выключен полностью. */
export const REASONING_HEADROOM_TOKENS = 1024;

/**
 * Параметры запроса под конкретную модель: подставляет `model`, убирает
 * `temperature` там, где его не принимают, и добавляет `reasoning` для
 * reasoning-моделей. Если reasoning выключить нельзя или его включили через
 * AI_REASONING_EFFORT, к `max_tokens` добавляется запас под reasoning-токены;
 * при `effort: "none"` и у не-reasoning моделей `max_tokens` прежний. Исходный объект не
 * мутирует.
 */
export function modelRequestParams<T extends { model: string; temperature?: number | null }>(
  modelId: string,
  base: T,
  reasoningOverride?: ReasoningEffort,
): T & { reasoning?: { effort: ReasoningEffort } } {
  const out: T & { reasoning?: { effort: ReasoningEffort } } = { ...base, model: modelId };
  if (!supportsTemperature(modelId)) delete out.temperature;
  const reasoning = reasoningFor(modelId, reasoningOverride);
  if (reasoning) {
    out.reasoning = reasoning;
    // Reasoning-токены считаются в max_tokens. При лимите 30–50 (classifyIntent,
    // detectBarcode) модель, которой reasoning не выключить, вернула бы пустой
    // ответ — и classifyIntent молча ответил бы "other".
    const max = (out as { max_tokens?: number | null }).max_tokens;
    if (reasoning.effort !== "none" && typeof max === "number") {
      (out as { max_tokens?: number | null }).max_tokens = max + REASONING_HEADROOM_TOKENS;
    }
  }
  return out;
}

/**
 * Один повтор на запасной модели, если основной вызов окончательно упал
 * (ретраи уже исчерпаны внутри `primary`). Без fallback ошибка пробрасывается
 * как есть.
 */
export async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: (() => Promise<T>) | undefined,
  onFallback?: (err: unknown) => void,
): Promise<T> {
  try {
    return await primary();
  } catch (err) {
    if (!fallback) throw err;
    onFallback?.(err);
    return fallback();
  }
}
