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
import type { User } from "@shared/schema";
import {
  dayQuerySchema,
  statsQuerySchema,
  weightQuerySchema,
  updateLogSchema,
  waterSchema,
  profilePatchSchema,
  settingsPatchSchema,
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

/** Strip server-only fields from a user before sending it to the client. */
function publicUser(user: User) {
  const { healthSyncToken, ...rest } = user;
  return rest;
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

// ─── Router ──────────────────────────────────────────────────────────────────

export function createAppApiRouter(): Router {
  const router = Router();

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

      res.json({
        date: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
        foodLogs,
        waterTotal,
        waterLogs,
        workouts,
        totals,
        goals: userGoals(user),
        energyBalance,
      });
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
