/**
 * Telegram Mini App REST API — mounted at `/api/app` behind `telegramAuth`.
 *
 * All endpoints require a valid `Authorization: tma <initData>` header
 * (see `server/lib/telegram-auth.ts`) and are rate-limited per user id.
 * Input is validated with the zod schemas from `shared/routes.ts`; output is
 * JSON. Errors: zod → 400 with details, anything else → 500 (no stack leaked).
 */
import { Router, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { z, ZodError } from "zod";
import { storage as defaultStorage, type IStorage } from "./storage";
import { telegramAuth } from "./lib/telegram-auth";
import { computeEnergyBalance } from "./lib/energy";
import { describeError } from "./lib/safe-log";
import { publicUser } from "./lib/public-user";
import { mealTypeByTime, sameTitle } from "./lib/favorites";
import { dayBoundsUtc, isValidDayKey, resolveTz, todayKey, wallClockDate } from "./lib/tz";
import {
  analyzeFoodImage as defaultAnalyzeImage,
  analyzeFoodText as defaultAnalyzeText,
  detectBarcode as defaultDetectBarcode,
  transcribeVoice,
  type FoodItem,
} from "./openai";
import { decodeBarcodeFromImage } from "./barcode";
import { lookupBarcodeProduct } from "./lib/open-food-facts";
import { findBarcode, resolveBarcodeProduct, visionHintForMiss } from "./lib/barcode-pipeline";
import { prepareVoice } from "./lib/voice-transcode";
import type { AiActionKind, AiQuota } from "./lib/ai-quota";
import { getSharedAiQuota, quotaTz } from "./lib/ai-quota-instance";
import type { User, FoodLog, FavoriteItem, VisibleFavorite } from "@shared/schema";
import {
  dayQuerySchema,
  statsQuerySchema,
  weightQuerySchema,
  updateLogSchema,
  waterSchema,
  profilePatchSchema,
  settingsPatchSchema,
  createFavoriteSchema,
  updateFavoriteSchema,
  analyzeSchema,
  transcribeSchema,
  createLogsSchema,
  idParam,
  mealTypeEnum,
  type AnalyzedItemInput,
} from "@shared/routes";

// ─── Dependencies ────────────────────────────────────────────────────────────

/** Методы storage, которыми пользуется Mini App API. */
export type AppApiStorage = Pick<
  IStorage,
  | "getDailyStats"
  | "getDailyWater"
  | "getDailyWaterLogs"
  | "getDailyWorkouts"
  | "getFoodLogsInRange"
  | "logWater"
  | "createFoodLog"
  | "getMonthlyStats"
  | "getWeeklyFullStats"
  | "getStreak"
  | "getWeightLogs"
  | "updateFoodLog"
  | "getFoodLogById"
  | "deleteFoodLog"
  | "deleteWaterLog"
  | "getVisibleFavorites"
  | "getFavorites"
  | "createFavorite"
  | "getVisibleFavoriteById"
  | "setFavoriteShared"
  | "deleteFavorite"
  | "updateUser"
  | "calculateAndSetGoals"
  | "getBarcodeProduct"
  | "upsertBarcodeProduct"
>;

/**
 * Результат расшифровки голоса: текст (null/пустой — не распознано), отказ
 * по длительности или «занято» (все слоты перекодирования заняты).
 */
export type TranscribeResult = { text: string | null } | { tooLong: true } | { busy: true };

/**
 * Зависимости роутера. В проде все по умолчанию (Postgres, боевой
 * telegramAuth, OpenRouter); тесты подставляют in-memory storage, auth со
 * своим токеном и анализатор без LLM.
 */
export type AppApiDeps = {
  storage: AppApiStorage;
  auth: RequestHandler;
  analyzeFoodImage: typeof defaultAnalyzeImage;
  analyzeFoodText: typeof defaultAnalyzeText;
  /** zxing по пикселям фото. */
  decodeBarcode: (image: Buffer) => Promise<string | null>;
  /** AI-чтение штрихкода (только режим barcode). */
  detectBarcodeAi: (imageBase64: string) => Promise<string | null>;
  /** Open Food Facts. */
  lookupBarcodeOff: typeof lookupBarcodeProduct;
  /** Голос → текст: по умолчанию ffmpeg → ogg/opus → transcribeVoice. */
  transcribeAudio: (audio: Buffer, mimeType: string) => Promise<TranscribeResult>;
  /** Дневная AI-квота: по умолчанию общая с ботом (lib/ai-quota-instance.ts). */
  aiQuota: Pick<AiQuota, "tryConsume">;
};

/** Боевая расшифровка: перекодирование, проверка длительности, LLM. */
async function defaultTranscribeAudio(audio: Buffer, mimeType: string): Promise<TranscribeResult> {
  const prepared = await prepareVoice(audio, mimeType);
  if (!prepared.ok) {
    if (prepared.reason === "too_long") return { tooLong: true };
    if (prepared.reason === "busy") return { busy: true };
    return { text: null };
  }
  return { text: await transcribeVoice(prepared.audio, prepared.durationSec ?? undefined) };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Wrap an async handler so thrown errors reach the router error middleware. */
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/** The authenticated user is guaranteed by `telegramAuth`. */
function currentUser(req: Request): User {
  return req.appUser as User;
}

/** Shape a favorite for the client: only the fields the Mini App needs. */
function publicFavorite(fav: VisibleFavorite) {
  return {
    id: fav.id,
    title: fav.title,
    items: fav.items,
    isShared: fav.isShared,
    isOwner: fav.isOwner,
    ownerName: fav.ownerName,
  };
}

function userGoals(user: User) {
  return {
    calories: user.caloriesGoal ?? null,
    protein: user.proteinGoal ?? null,
    fat: user.fatGoal ?? null,
    carbs: user.carbsGoal ?? null,
  };
}

/** Request day "YYYY-MM-DD": query value or today in the user's tz. */
function resolveDay(dateStr: string | undefined, tz: string): string {
  return dateStr ?? todayKey(new Date(), tz);
}

/** Current wall-clock time in the user's tz (for meal type by time of day). */
function userNow(tz: string): Date {
  return wallClockDate(new Date(), tz);
}

/** User's tz, validated (unknown → Europe/Moscow). */
function userTz(user: User): string {
  return resolveTz(user.timezone);
}

/** The user's configured meal-time boundaries (same defaults as the bot). */
function mealBoundaries(user: User) {
  return {
    breakfastEnd: user.mealBreakfastEnd ?? "12:30",
    lunchEnd: user.mealLunchEnd ?? "16:30",
  };
}

/**
 * Позиция для ответа /analyze — ровно поля `analyzedItemSchema` (она .strict(),
 * клиент шлёт эти позиции в POST /logs как есть). Лишнее (barcode, foundInDb,
 * что ещё добавила модель) отбрасываем; неизвестный mealType → `fallbackMeal`.
 */
function toAnalyzedItem(it: FoodItem, fallbackMeal: AnalyzedItemInput["mealType"]): AnalyzedItemInput {
  const meal = mealTypeEnum.safeParse(it.mealType);
  const out: AnalyzedItemInput = {
    foodName: it.foodName,
    calories: it.calories,
    protein: it.protein,
    fat: it.fat,
    carbs: it.carbs,
    weight: it.weight,
    mealType: meal.success ? meal.data : fallbackMeal,
  };
  if (it.hydrating !== undefined) out.hydrating = it.hydrating;
  // Модель бывает неаккуратна: оценка «3.6», совет длиннее лимита схемы.
  if (it.foodScore !== undefined) {
    out.foodScore = it.foodScore === null ? null : Math.min(10, Math.max(1, Math.round(it.foodScore)));
  }
  if (it.nutritionAdvice !== undefined) {
    out.nutritionAdvice = it.nutritionAdvice === null ? null : it.nutritionAdvice.slice(0, 500);
  }
  if (it.fiber !== undefined) out.fiber = it.fiber;
  if (it.sugar !== undefined) out.sugar = it.sugar;
  if (it.sodium !== undefined) out.sodium = it.sodium;
  if (it.saturatedFat !== undefined) out.saturatedFat = it.saturatedFat;
  return out;
}

/** The full day payload (same shape GET /day returns) — reused after writes. */
async function buildDayPayload(storage: AppApiStorage, user: User, day: string) {
  const tz = userTz(user);
  const { start, end } = dayBoundsUtc(day, tz);
  const [totals, waterTotal, waterLogs, workouts, foodLogs] = await Promise.all([
    storage.getDailyStats(user.id, day, tz),
    storage.getDailyWater(user.id, day, tz),
    storage.getDailyWaterLogs(user.id, day, tz),
    storage.getDailyWorkouts(user.id, day, tz),
    storage.getFoodLogsInRange(user.id, start, end),
  ]);
  const burnedTotal = workouts.reduce((s, w) => s + w.caloriesBurned, 0);
  const energyBalance = computeEnergyBalance(user, totals.calories, burnedTotal);
  return {
    date: day,
    foodLogs,
    waterTotal,
    waterLogs,
    workouts,
    totals,
    goals: userGoals(user),
    energyBalance,
  };
}

/**
 * Write favorite/repeat items onto today, assigning mealType by the user's
 * CURRENT wall-clock time. Hydrating items go to water, the rest to the diary.
 * Mirrors `applyItemsToToday` in server/bot.ts.
 */
async function applyItemsToToday(
  storage: AppApiStorage,
  user: User,
  items: FavoriteItem[],
): Promise<{ createdFood: FoodLog[]; waterAdded: number }> {
  const tz = userTz(user);
  const mealType = mealTypeByTime(userNow(tz), mealBoundaries(user));

  const createdFood: FoodLog[] = [];
  let waterAdded = 0;
  for (const it of items) {
    if (it.hydrating) {
      const amount = Math.round(Number(it.weight)) || 0;
      if (amount > 0) {
        await storage.logWater(user.id, amount);
        waterAdded += amount;
      }
      continue;
    }
    const log = await storage.createFoodLog({
      userId: user.id,
      foodName: it.foodName,
      calories: Math.round(Number(it.calories)) || 0,
      protein: Math.round(Number(it.protein)) || 0,
      fat: Math.round(Number(it.fat)) || 0,
      carbs: Math.round(Number(it.carbs)) || 0,
      weight: Math.round(Number(it.weight)) || 0,
      mealType,
      foodScore: null,
      nutritionAdvice: null,
      fiber: null,
      sugar: null,
      sodium: null,
      saturatedFat: null,
    });
    createdFood.push(log);
  }
  return { createdFood, waterAdded };
}

// ─── Router ──────────────────────────────────────────────────────────────────

export function createAppApiRouter(overrides: Partial<AppApiDeps> = {}): Router {
  const {
    storage = defaultStorage,
    auth = telegramAuth,
    analyzeFoodImage = defaultAnalyzeImage,
    analyzeFoodText = defaultAnalyzeText,
    decodeBarcode = decodeBarcodeFromImage,
    detectBarcodeAi = defaultDetectBarcode,
    lookupBarcodeOff = lookupBarcodeProduct,
    transcribeAudio = defaultTranscribeAudio,
    aiQuota = getSharedAiQuota(),
  } = overrides;
  const router = Router();

  /**
   * Списать одно AI-действие из дневной квоты (общей с ботом). Отказ → 429
   * `quota_exceeded`, возвращает false. Вызывать после валидации тела и до
   * AI-вызова. Админу о Mini App-отказах не пишем — бота здесь нет.
   */
  function consumeAiQuota(user: User, kind: AiActionKind, res: Response): boolean {
    const check = aiQuota.tryConsume(String(user.id), quotaTz(user), kind);
    if (check.allowed) return true;
    console.warn(`[ai-quota] limit reached (miniapp): userId=${user.id} reason=${check.reason}`);
    res.status(429).json({ error: "quota_exceeded" });
    return false;
  }

  // Auth first — so the rate-limit key can use the resolved user id.
  router.use(auth);

  // ~120 requests/min per user (keyed by user id, not IP).
  router.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: Request) => String(req.appUser?.id ?? "anon"),
      // We key by user id (already authenticated), not IP.
      validate: { keyGeneratorIpFallback: false },
      message: { error: "rate_limited" },
    }),
  );

  // AI-вызовы дорогие — отдельный лимит поверх router-wide: 10 запросов/мин на
  // пользователя (ключ — user id, уже аутентифицирован, без IP-фолбэка).
  const analyzeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => String(req.appUser?.id ?? "anon"),
    validate: { keyGeneratorIpFallback: false },
    message: { error: "rate_limited" },
  });

  // POST /api/app/analyze { text? | imageBase64?, mode? } — распознать еду,
  // ничего не пишем. Ровно одно из text/imageBase64 (см. analyzeSchema).
  // Фото сначала проверяем на штрихкод (lib/barcode-pipeline): в режиме photo —
  // только zxing и только при включённой настройке, в режиме barcode — zxing,
  // затем AI. Продукт из кэша/OFF → source "barcode"; иначе vision (с
  // подсказкой, если код нашёлся). 422: unrecognized | no_barcode.
  router.post(
    "/analyze",
    analyzeLimiter,
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const tz = userTz(user);
      const body = analyzeSchema.parse(req.body);
      // Фото (в том числе режим barcode) — из фото-лимита, текст — из общего.
      if (!consumeAiQuota(user, body.imageBase64 ? "photo" : "request", res)) return;

      const now = userNow(tz);
      const bounds = mealBoundaries(user);
      const mealByTime = mealTypeByTime(now, bounds);

      let items: FoodItem[] | null;
      if (body.imageBase64) {
        const mode = body.mode ?? "photo";
        let hint: { productName?: string; barcode: string } | undefined;
        if (mode === "barcode" || (user.barcodeScanEnabled ?? true)) {
          const code = await findBarcode(
            Buffer.from(body.imageBase64, "base64"),
            body.imageBase64,
            { useAi: mode === "barcode" },
            { decode: decodeBarcode, detectAi: detectBarcodeAi },
          );
          if (!code && mode === "barcode") {
            res.status(422).json({ error: "no_barcode" });
            return;
          }
          if (code) {
            const product = await resolveBarcodeProduct(code, {
              lookupOff: lookupBarcodeOff,
              getCached: (c) => storage.getBarcodeProduct(c),
              upsertCached: (rec) => storage.upsertBarcodeProduct(rec),
            });
            if (product.found) {
              // OFF и кэш ставят "snack" — приём пищи считаем по времени, как у repeat.
              const item = toAnalyzedItem({ ...product.item, mealType: mealByTime }, mealByTime);
              res.json({ items: [item], source: "barcode" });
              return;
            }
            hint = visionHintForMiss(code, product);
          }
        }
        items = await analyzeFoodImage(body.imageBase64, now, bounds, hint);
      } else {
        items = await analyzeFoodText(body.text as string, now, bounds);
      }

      if (!items || items.length === 0) {
        res.status(422).json({ error: "unrecognized" });
        return;
      }
      res.json({ items: items.map((it) => toAnalyzedItem(it, mealByTime)), source: "vision" });
    }),
  );

  // POST /api/app/transcribe { audioBase64, mimeType } — голос → текст, ничего
  // не пишем. Тот же AI-лимит, что у /analyze, и дневная квота (request).
  // 422: unrecognized | too_long; 503: busy — все слоты ffmpeg заняты.
  // Ни текст расшифровки, ни аудио в лог не идут.
  router.post(
    "/transcribe",
    analyzeLimiter,
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const body = transcribeSchema.parse(req.body);
      if (!consumeAiQuota(user, "request", res)) return;
      const result = await transcribeAudio(Buffer.from(body.audioBase64, "base64"), body.mimeType);
      if ("busy" in result) {
        res.status(503).json({ error: "busy" });
        return;
      }
      if ("tooLong" in result) {
        res.status(422).json({ error: "too_long" });
        return;
      }
      const text = result.text?.trim();
      if (!text) {
        res.status(422).json({ error: "unrecognized" });
        return;
      }
      res.json({ text });
    }),
  );

  // POST /api/app/logs { items } — записать подтверждённые позиции. Гидратирующие
  // (hydrating) идут в воду, остальные — в дневник со ВСЕМИ полями. Форма ответа
  // совпадает с POST /favorites/:id/log — клиент уже умеет её читать.
  router.post(
    "/logs",
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const { items } = createLogsSchema.parse(req.body);

      const createdFood: FoodLog[] = [];
      let waterAdded = 0;
      for (const it of items) {
        if (it.hydrating) {
          const amount = Math.round(it.weight) || 0;
          if (amount > 0) {
            await storage.logWater(user.id, amount);
            waterAdded += amount;
          }
          continue;
        }
        const log = await storage.createFoodLog({
          userId: user.id,
          foodName: it.foodName,
          calories: Math.round(it.calories) || 0,
          protein: Math.round(it.protein) || 0,
          fat: Math.round(it.fat) || 0,
          carbs: Math.round(it.carbs) || 0,
          weight: Math.round(it.weight) || 0,
          mealType: it.mealType,
          foodScore: it.foodScore ?? null,
          nutritionAdvice: it.nutritionAdvice ?? null,
          fiber: it.fiber ?? null,
          sugar: it.sugar ?? null,
          sodium: it.sodium ?? null,
          saturatedFat: it.saturatedFat ?? null,
        });
        createdFood.push(log);
      }
      const day = await buildDayPayload(storage, user, todayKey(new Date(), userTz(user)));
      res.status(201).json({ ok: true, createdFood, waterAdded, day });
    }),
  );

  // GET /api/app/me — profile + goals. Поля — allowlist из lib/public-user:
  // без quickToken, telegramId и флагов доступа.
  router.get(
    "/me",
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      res.json({ ...publicUser(user), goals: userGoals(user) });
    }),
  );

  // GET /api/app/day?date=YYYY-MM-DD
  router.get(
    "/day",
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const tz = userTz(user);
      const { date } = dayQuerySchema.parse(req.query);
      // Формат проверила схема; несуществующая дата (2026-02-31) — тоже 400.
      if (date && !isValidDayKey(date)) {
        res.status(400).json({ error: "validation_error" });
        return;
      }
      const day = resolveDay(date, tz);
      res.json(await buildDayPayload(storage, user, day));
    }),
  );

  // GET /api/app/stats?range=week|month&end=YYYY-MM-DD — end только для week:
  // неделя кончается этим днём (не позже сегодняшнего), по умолчанию сегодня.
  router.get(
    "/stats",
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const tz = userTz(user);
      const { range, end } = statsQuerySchema.parse(req.query);
      // Несуществующая дата или будущее по часам пользователя — 400.
      if (end !== undefined && (!isValidDayKey(end) || end > todayKey(new Date(), tz))) {
        res.status(400).json({ error: "validation_error" });
        return;
      }

      if (range === "month") {
        const [months, streak] = await Promise.all([
          storage.getMonthlyStats(user.id, tz),
          storage.getStreak(user.id, tz),
        ]);
        res.json({ range, streak, weeks: months });
      } else {
        const [days, streak] = await Promise.all([
          storage.getWeeklyFullStats(user.id, tz, end),
          storage.getStreak(user.id, tz),
        ]);
        res.json({ range, streak, days });
      }
    }),
  );

  // GET /api/app/weight?limit=90
  router.get(
    "/weight",
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const { limit } = weightQuerySchema.parse(req.query);
      const logs = await storage.getWeightLogs(user.id, limit);
      res.json({ logs });
    }),
  );

  // PATCH /api/app/logs/:id — edit a food entry (ownership enforced in storage).
  router.patch(
    "/logs/:id",
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const id = idParam.parse(req.params.id);
      const data = updateLogSchema.parse(req.body);

      const updated = await storage.updateFoodLog(id, user.id, data);
      if (!updated) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json(updated);
    }),
  );

  // DELETE /api/app/logs/:id
  router.delete(
    "/logs/:id",
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const id = idParam.parse(req.params.id);

      const existing = await storage.getFoodLogById(id, user.id);
      if (!existing) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      await storage.deleteFoodLog(id, user.id);
      res.json({ ok: true });
    }),
  );

  // POST /api/app/water { amount }
  router.post(
    "/water",
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const { amount } = waterSchema.parse(req.body);
      await storage.logWater(user.id, amount);
      const tz = userTz(user);
      const total = await storage.getDailyWater(user.id, todayKey(new Date(), tz), tz);
      res.status(201).json({ ok: true, waterTotal: total });
    }),
  );

  // DELETE /api/app/water/:id
  router.delete(
    "/water/:id",
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const id = idParam.parse(req.params.id);
      // Чужая или уже удалённая запись — 404, как у DELETE /logs/:id.
      if (!(await storage.deleteWaterLog(id, user.id))) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({ ok: true });
    }),
  );

  // POST /api/app/logs/:id/repeat — copy a past food entry onto today
  // (mealType by the user's current time). Ownership enforced via getFoodLogById.
  router.post(
    "/logs/:id/repeat",
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const id = idParam.parse(req.params.id);

      const log = await storage.getFoodLogById(id, user.id);
      if (!log) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const { createdFood } = await applyItemsToToday(storage, user, [
        {
          foodName: log.foodName,
          calories: log.calories,
          protein: log.protein,
          fat: log.fat,
          carbs: log.carbs,
          weight: log.weight,
        },
      ]);
      const day = await buildDayPayload(storage, user, todayKey(new Date(), userTz(user)));
      res.status(201).json({ ok: true, createdFood, waterAdded: 0, day });
    }),
  );

  // GET /api/app/favorites — visible list: the user's own + everyone's shared.
  router.get(
    "/favorites",
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const favorites = await storage.getVisibleFavorites(user.id);
      res.json({ favorites: favorites.map(publicFavorite) });
    }),
  );

  // POST /api/app/favorites { title, items } — save a favorite (always own).
  router.post(
    "/favorites",
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const { title, items } = createFavoriteSchema.parse(req.body);
      // De-dup: if the user already has a favorite with this title (case-insensitive),
      // return it (200) instead of creating a duplicate row.
      const own = await storage.getFavorites(user.id);
      const existing = own.find((f) => sameTitle(f.title, title));
      if (existing) {
        res.status(200).json(
          publicFavorite({ ...existing, isOwner: true, ownerName: user.username ?? null }),
        );
        return;
      }
      const fav = await storage.createFavorite({ userId: user.id, title, items });
      res.status(201).json(
        publicFavorite({ ...fav, isOwner: true, ownerName: user.username ?? null }),
      );
    }),
  );

  // PATCH /api/app/favorites/:id { isShared } — owner toggles sharing.
  // 404 when the favorite isn't visible at all, 403 when it's someone else's.
  router.patch(
    "/favorites/:id",
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const id = idParam.parse(req.params.id);
      const { isShared } = updateFavoriteSchema.parse(req.body);

      const fav = await storage.getVisibleFavoriteById(user.id, id);
      if (!fav) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (!fav.isOwner) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const updated = await storage.setFavoriteShared(user.id, id, isShared);
      if (!updated) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json(publicFavorite({ ...updated, isOwner: true, ownerName: user.username ?? null }));
    }),
  );

  // DELETE /api/app/favorites/:id — remove a favorite (ownership in the WHERE).
  router.delete(
    "/favorites/:id",
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const id = idParam.parse(req.params.id);
      // Чужое (в том числе общее) или уже удалённое — 404, а не «ok» без удаления.
      if (!(await storage.deleteFavorite(user.id, id))) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({ ok: true });
    }),
  );

  // POST /api/app/favorites/:id/log — write a favorite onto today. Allowed for
  // the user's own favorites and for anyone's shared ones (into their diary).
  router.post(
    "/favorites/:id/log",
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const id = idParam.parse(req.params.id);

      const fav = await storage.getVisibleFavoriteById(user.id, id);
      if (!fav) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const { createdFood, waterAdded } = await applyItemsToToday(storage, user, fav.items);
      const day = await buildDayPayload(storage, user, todayKey(new Date(), userTz(user)));
      res.status(201).json({ ok: true, createdFood, waterAdded, day });
    }),
  );

  // PATCH /api/app/profile — profile fields + optional goal recalculation.
  router.patch(
    "/profile",
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const body = profilePatchSchema.parse(req.body);
      const { recalc, ...fields } = body;

      let updated = user;
      if (Object.keys(fields).length > 0) {
        updated = await storage.updateUser(user.id, fields);
      }
      if (recalc) {
        updated = await storage.calculateAndSetGoals(user.id);
      }
      res.json({ ...publicUser(updated), goals: userGoals(updated) });
    }),
  );

  // PATCH /api/app/settings — toggles and times.
  router.patch(
    "/settings",
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const body = settingsPatchSchema.parse(req.body);
      const updated = await storage.updateUser(user.id, body);
      res.json({ ...publicUser(updated), goals: userGoals(updated) });
    }),
  );

  // Router-scoped error handler: zod → 400 with details, else → 500 (no stack).
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: "validation_error", details: err.flatten() });
      return;
    }
    console.error("[app-api] error:", describeError(err));
    res.status(500).json({ error: "internal_error" });
  });

  return router;
}

// Re-exported for convenience / potential direct import in tests.
export { z };
