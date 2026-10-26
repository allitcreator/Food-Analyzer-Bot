/**
 * Общая дневная AI-квота процесса: один счётчик на пользователя для бота и
 * Mini App, чтобы лимит нельзя было обойти, переключаясь между ними.
 * Создаётся лениво при первом обращении, лимиты — из config
 * (AI_DAILY_LIMIT / AI_DAILY_PHOTO_LIMIT).
 */
import { config } from "../config";
import { createAiQuota, type AiQuota } from "./ai-quota";

let shared: AiQuota | null = null;

export function getSharedAiQuota(): AiQuota {
  shared ??= createAiQuota({ dailyRequests: config.aiDailyLimit, dailyPhotos: config.aiDailyPhotoLimit });
  return shared;
}

/**
 * Часовой пояс для ключа дня в квоте — тот же, что у бота: иначе бот и
 * Mini App считали бы разные сутки и сбрасывали счётчик друг другу.
 */
export function quotaTz(user: { timezone?: string | null }): string {
  return user.timezone ?? "Europe/Moscow";
}
