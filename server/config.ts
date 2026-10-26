import { parsePositiveInt } from "./lib/ai-quota";
import { resolveAIModels } from "./lib/ai-models";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const config = {
  telegramBotToken:  requireEnv("TELEGRAM_BOT_TOKEN"),
  openrouterApiKey:  requireEnv("OPENROUTER_API_KEY"),
  databaseUrl:       requireEnv("DATABASE_URL"),

  adminTelegramId:   optionalEnv("ADMIN_TELEGRAM_ID"),
  webhookUrl:        optionalEnv("WEBHOOK_URL"),
  webhookSecret:     optionalEnv("WEBHOOK_SECRET"),

  port: parseInt(process.env.PORT || "5000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  tz: process.env.TZ || "Europe/Moscow",

  // Дневные лимиты AI на пользователя (см. server/lib/ai-quota.ts), счётчик
  // общий у бота и Mini App (lib/ai-quota-instance.ts). /api/quick ограничен
  // отдельно, в своём роутере.
  aiDailyLimit:      parsePositiveInt(process.env.AI_DAILY_LIMIT, 150),
  aiDailyPhotoLimit: parsePositiveInt(process.env.AI_DAILY_PHOTO_LIMIT, 40),
  voiceMaxSeconds:   parsePositiveInt(process.env.VOICE_MAX_SECONDS, 300),

  // Модели ИИ по ролям (AI_MODEL_VISION/TEXT/CHAT/AUDIO), запасные модели
  // (AI_FALLBACK_*) и уровень reasoning (AI_REASONING_EFFORT). Без переменных —
  // те же модели, что были захардкожены. См. server/lib/ai-models.ts и DEPLOY.md.
  // Объекты изменяемые: openai.ts читает их на каждом вызове, eval-скрипт
  // подменяет модель без перезапуска процесса.
  ...(() => {
    const ai = resolveAIModels(process.env);
    return {
      aiModels: ai.primary,
      aiFallbackModels: ai.fallback,
      aiReasoningEffort: ai.reasoningEffort,
    };
  })(),
};
