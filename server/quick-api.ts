/**
 * Быстрая запись с телефона — `POST /api/quick` (проектная заметка QUICK-ENTRY.md).
 *
 * Шорткат iOS шлёт сюда текст и/или фото с заголовком
 * `Authorization: Bearer <users.quick_token>`. Эндпоинт НИЧЕГО не анализирует
 * сам: он вбрасывает синтетический Telegram-Update в уже работающий
 * `bot.on("message")` (см. `injectUserMessage`), поэтому бесплатно достаются
 * штрихкоды, мультиблюдо, вода и карточка подтверждения с правкой веса.
 *
 * Отвечаем `202` сразу, не дожидаясь AI: разбор занимает 3–30 секунд, шорткату
 * столько висеть незачем — результат придёт пушем в Telegram.
 *
 * Токен (в отличие от снесённого health-sync) ездит в заголовке, а не в URL:
 * прошлый аудит поймал утечку токена в nginx access-логи.
 */
import { Router, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { storage } from "./storage";
import { quickSchema, type QuickBody } from "@shared/routes";
import { getBotInstance, injectUserMessage } from "./bot";
import { extractBearerToken } from "./lib/quick-auth";
import type { User } from "@shared/schema";

/**
 * Авторизация по персональному токену быстрой записи.
 *
 * - 401 `invalid_token` — заголовка нет, он кривой или токен неизвестен
 *   (одинаковый ответ на «нет заголовка» и «нет такого токена» — не сообщаем,
 *   существует ли токен);
 * - 403 `blocked` / `not_approved` — те же правила доступа, что и у Mini App.
 */
const quickAuth: RequestHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = extractBearerToken(req.headers["authorization"]);
  if (!token) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }

  let user: User | undefined;
  try {
    user = await storage.getUserByQuickToken(token);
  } catch (err) {
    next(err);
    return;
  }

  if (!user) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }
  if (user.isBlocked) {
    res.status(403).json({ error: "blocked" });
    return;
  }
  if (!user.isApproved && !user.isAdmin) {
    res.status(403).json({ error: "not_approved" });
    return;
  }

  req.appUser = user;
  next();
};

/**
 * Доставить быструю запись в цепочку бота.
 *
 * Фото сначала уходит в чат обычным `sendPhoto` — так снимок остаётся в истории
 * (видно, что именно записывал), а Telegram возвращает `file_id`, с которым
 * дальше работает штатный обработчик фото. Текст рядом с фото становится
 * подписью — её читает vision (P1-баг №10: раньше подпись терялась).
 */
export async function dispatchQuickEntry(user: User, body: QuickBody): Promise<void> {
  const telegramId = user.telegramId;
  if (!telegramId) throw new Error("user has no telegram id");

  if (!body.imageBase64) {
    if (!injectUserMessage(telegramId, { text: body.text })) {
      throw new Error("bot is not running");
    }
    return;
  }

  const bot = getBotInstance();
  if (!bot) throw new Error("bot is not running");

  const photo = Buffer.from(body.imageBase64, "base64");
  const sent = await bot.sendPhoto(
    Number(telegramId),
    photo,
    body.text ? { caption: body.text } : {},
    { filename: "quick.jpg", contentType: "image/jpeg" },
  );

  // Массив размеров отсортирован по возрастанию — берём самый крупный.
  const sizes = sent.photo ?? [];
  const fileId = sizes[sizes.length - 1]?.file_id;
  if (!fileId) throw new Error("telegram returned no file_id");

  if (!injectUserMessage(telegramId, { photoFileId: fileId, caption: body.text })) {
    throw new Error("bot is not running");
  }
}

export function createQuickRouter(): Router {
  const router = Router();

  // Авторизация первой — ключ rate-limit'а берётся из уже опознанного юзера.
  router.use(quickAuth);

  // 30 запросов/час на пользователя. Это не защита от DDoS, а потолок трат на
  // OpenRouter, если шорткат утечёт: шорткаты синкаются в iCloud и делятся
  // ссылкой, а один текстовый ввод — это два AI-вызова.
  router.use(
    rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 30,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: Request) => String(req.appUser?.id ?? "anon"),
      validate: { keyGeneratorIpFallback: false },
      message: { error: "rate_limited" },
    }),
  );

  router.post("/", (req: Request, res: Response) => {
    const parsed = quickSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "validation_error", details: parsed.error.issues });
      return;
    }

    const user = req.appUser as User;
    const body = parsed.data;
    res.status(202).json({
      ok: true,
      accepted: body.imageBase64 ? (body.text ? "photo+text" : "photo") : "text",
    });

    // Разбор — уже после ответа. Ошибку показываем пользователю в Telegram:
    // шорткат к этому моменту закрыт и HTTP-код никто не увидит.
    void dispatchQuickEntry(user, body).catch((err) => {
      console.error("[quick] dispatch failed:", err);
      const bot = getBotInstance();
      if (bot && user.telegramId) {
        bot
          .sendMessage(Number(user.telegramId), "⚠️ Не получилось принять быструю запись. Попробуй ещё раз или отправь сообщение боту напрямую.")
          .catch(() => {});
      }
    });
  });

  return router;
}
