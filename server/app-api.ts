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
import { storage } from "./storage";
import { telegramAuth } from "./lib/telegram-auth";
import { computeEnergyBalance } from "./lib/energy";
import { mealTypeByTime, sameTitle } from "./lib/favorites";
import { analyzeFoodImage, analyzeFoodText } from "./openai";
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
  createLogsSchema,
  idParam,
} from "@shared/routes";

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

/** Shape a user object before sending it to the client. */
function publicUser(user: User) {
  return { ...user };
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

/** Current calendar day in the user's timezone, as a server-local midnight Date. */
function userToday(tz: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(get("year"), get("month") - 1, get("day"));
}

/** Resolve the request date (query "YYYY-MM-DD" or today in the user's tz). */
function resolveDay(dateStr: string | undefined, tz: string): Date {
  if (!dateStr) return userToday(tz);
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dayBounds(day: Date): { start: Date; end: Date } {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(day);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/** ISO "YYYY-MM-DD" from a server-local Date. */
function isoOf(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

/** Current wall-clock time in the user's timezone (for "repeat"/favorites mealType). */
function userNow(tz: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  let hour = get("hour");
  if (hour === 24) hour = 0; // some engines emit 24 for midnight with hour12:false
  return new Date(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
}

/** The user's configured meal-time boundaries (same defaults as the bot). */
function mealBoundaries(user: User) {
  return {
    breakfastEnd: user.mealBreakfastEnd ?? "12:30",
    lunchEnd: user.mealLunchEnd ?? "16:30",
  };
}

/** The full day payload (same shape GET /day returns) — reused after writes. */
async function buildDayPayload(user: User, day: Date) {
  const { start, end } = dayBounds(day);
  const [totals, waterTotal, waterLogs, workouts, foodLogs] = await Promise.all([
    storage.getDailyStats(user.id, day),
    storage.getDailyWater(user.id, day),
    storage.getDailyWaterLogs(user.id, day),
    storage.getDailyWorkouts(user.id, day),
    storage.getFoodLogsInRange(user.id, start, end),
  ]);
  const burnedTotal = workouts.reduce((s, w) => s + w.caloriesBurned, 0);
  const energyBalance = computeEnergyBalance(user, totals.calories, burnedTotal);
  return {
    date: isoOf(day),
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
  user: User,
  items: FavoriteItem[],
): Promise<{ createdFood: FoodLog[]; waterAdded: number }> {
  const tz = user.timezone ?? "Europe/Moscow";
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

export function createAppApiRouter(): Router {
  const router = Router();

  // ─── ВРЕМЕННАЯ диагностика iOS-фриза ───────────────────────────────────────
  // POST /api/app/crumb?e=<step> — beacon-«крошка» от клиента. Стоит ДО
  // telegramAuth намеренно: navigator.sendBeacon не умеет ставить заголовок
  // Authorization. Тело не парсим, читаем только query-параметр `e`, логируем и
  // отвечаем 204. Отдельный rate-limit по IP (120/мин), чтобы неаутентифициро-
  // ванный эндпоинт нельзя было заспамить. Никаких записей в БД.
  // Удалить после расследования фриза на iPhone.
  router.post(
    "/crumb",
    rateLimit({
      windowMs: 60 * 1000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "rate_limited" },
    }),
    (req: Request, res: Response) => {
      const e = String(req.query.e ?? "").slice(0, 300);
      console.log("[crumb]", new Date().toISOString(), e);
      res.status(204).end();
    },
  );

  // Auth first — so the rate-limit key can use the resolved user id.
  router.use(telegramAuth);

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

  // POST /api/app/analyze { text? | imageBase64? } — распознать еду, ничего не
  // пишем. Ровно одно из полей (см. analyzeSchema). 422, если AI не распознал.
  router.post(
    "/analyze",
    analyzeLimiter,
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const tz = user.timezone ?? "Europe/Moscow";
      const body = analyzeSchema.parse(req.body);

      const now = userNow(tz);
      const bounds = mealBoundaries(user);
      const items = body.imageBase64
        ? await analyzeFoodImage(body.imageBase64, now, bounds)
        : await analyzeFoodText(body.text as string, now, bounds);

      if (!items || items.length === 0) {
        res.status(422).json({ error: "unrecognized" });
        return;
      }
      res.json({ items });
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
      const day = await buildDayPayload(user, userToday(user.timezone ?? "Europe/Moscow"));
      res.status(201).json({ ok: true, createdFood, waterAdded, day });
    }),
  );

  // GET /api/app/me — profile + goals (no server-only fields).
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
      const tz = user.timezone ?? "Europe/Moscow";
      const { date } = dayQuerySchema.parse(req.query);
      const day = resolveDay(date, tz);
      res.json(await buildDayPayload(user, day));
    }),
  );

  // GET /api/app/stats?range=week|month
  router.get(
    "/stats",
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const tz = user.timezone ?? "Europe/Moscow";
      const { range } = statsQuerySchema.parse(req.query);

      if (range === "month") {
        const [months, streak] = await Promise.all([
          storage.getMonthlyStats(user.id, tz),
          storage.getStreak(user.id, tz),
        ]);
        res.json({ range, streak, weeks: months });
      } else {
        const [days, streak] = await Promise.all([
          storage.getWeeklyFullStats(user.id, tz),
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
      const total = await storage.getDailyWater(user.id, userToday(user.timezone ?? "Europe/Moscow"));
      res.status(201).json({ ok: true, waterTotal: total });
    }),
  );

  // DELETE /api/app/water/:id
  router.delete(
    "/water/:id",
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const id = idParam.parse(req.params.id);
      await storage.deleteWaterLog(id, user.id);
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
      const { createdFood } = await applyItemsToToday(user, [
        {
          foodName: log.foodName,
          calories: log.calories,
          protein: log.protein,
          fat: log.fat,
          carbs: log.carbs,
          weight: log.weight,
        },
      ]);
      const day = await buildDayPayload(user, userToday(user.timezone ?? "Europe/Moscow"));
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
      await storage.deleteFavorite(user.id, id);
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
      const { createdFood, waterAdded } = await applyItemsToToday(user, fav.items);
      const day = await buildDayPayload(user, userToday(user.timezone ?? "Europe/Moscow"));
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
    console.error("[app-api] error:", err);
    res.status(500).json({ error: "internal_error" });
  });

  return router;
}

// Re-exported for convenience / potential direct import in tests.
export { z };
