/**
 * Mini App API (`/api/app/*`) через настоящий HTTP: express + роутер из
 * server/app-api.ts, без Postgres и без LLM.
 *
 * Роутер собирается через `createAppApiRouter(deps)`: storage — in-memory фейк
 * ниже (повторяет поведение DatabaseStorage, включая владение в WHERE), auth —
 * боевой middleware из `createTelegramAuth` с тестовым токеном, анализаторы
 * еды — заглушки. initData подписывается так же, как в tests/telegram-auth.
 *
 * config и db импортируются транзитивно (server/storage, server/openai), поэтому
 * до импорта ставим фиктивные переменные окружения. Pool из pg без запросов к
 * базе не подключается, OpenAI-клиент без вызовов в сеть не ходит.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { User, FoodLog, WaterLog, Favorite, VisibleFavorite, FavoriteItem } from "../shared/schema";
import { TEST_TOKEN, buildInitData } from "./helpers/init-data";

process.env.TELEGRAM_BOT_TOKEN ??= TEST_TOKEN;
process.env.OPENROUTER_API_KEY ??= "test-key";
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/test";

const { createAppApiRouter } = await import("../server/app-api");
type AppApiDeps = import("../server/app-api").AppApiDeps;
type AppApiStorage = import("../server/app-api").AppApiStorage;
const { createTelegramAuth } = await import("../server/lib/telegram-auth");
const { todayKey, addDaysKey } = await import("../server/lib/tz");
const { lastNDayKeys, dayKeysEndingAt } = await import("../server/lib/stats-days");
const { analyzedItemSchema } = await import("../shared/routes");
const { createAiQuota } = await import("../server/lib/ai-quota");
const { getSharedAiQuota } = await import("../server/lib/ai-quota-instance");
type BarcodeProduct = import("../shared/schema").BarcodeProduct;
type InsertBarcodeProduct = import("../shared/schema").InsertBarcodeProduct;

// ─── Fake storage ────────────────────────────────────────────────────────────

const ZERO_TOTALS = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0, sodium: 0, saturatedFat: 0 };

function makeUser(p: Partial<User> & { id: number; telegramId: string }): User {
  return {
    username: null,
    isApproved: true,
    isAdmin: false,
    isBlocked: false,
    age: null,
    gender: null,
    weight: null,
    height: null,
    activityLevel: null,
    goal: null,
    caloriesGoal: null,
    proteinGoal: null,
    fatGoal: null,
    carbsGoal: null,
    reportTime: "21:00",
    breakfastReminder: "off",
    lunchReminder: "off",
    dinnerReminder: "off",
    noLogReminderTime: "off",
    weightReminderTime: "off",
    weightReminderDays: "",
    showMicronutrients: false,
    aiWeekAnalysis: true,
    aiMonthAnalysis: true,
    aiEveningReport: true,
    smartFoodGrouping: true,
    barcodeScanEnabled: true,
    smartReminders: false,
    quickToken: null,
    timezone: "Europe/Moscow",
    mealBreakfastEnd: "12:30",
    mealLunchEnd: "16:30",
    createdAt: new Date(),
    ...p,
  };
}

/**
 * In-memory реализация методов, которые зовёт app-api. Владение — как в
 * DatabaseStorage: userId в условии, чужая строка «не найдена».
 */
class FakeStorage implements AppApiStorage {
  users = new Map<number, User>();
  foodLogs: FoodLog[] = [];
  waterLogs: WaterLog[] = [];
  favorites: Favorite[] = [];
  barcodeProducts = new Map<string, BarcodeProduct>();
  private seq = 1000;
  /** Если задано — каждый вызов getFoodLogsInRange бросает это исключение. */
  failRange: Error | null = null;

  addUser(u: User) {
    this.users.set(u.id, u);
    return u;
  }

  async getUserByTelegramId(telegramId: string) {
    return Array.from(this.users.values()).find((u) => u.telegramId === telegramId);
  }

  addFoodLog(p: Partial<FoodLog> & { userId: number; foodName: string }): FoodLog {
    const log: FoodLog = {
      id: ++this.seq,
      calories: 100,
      protein: 1,
      fat: 1,
      carbs: 1,
      weight: 100,
      mealType: "lunch",
      foodScore: null,
      nutritionAdvice: null,
      fiber: null,
      sugar: null,
      sodium: null,
      saturatedFat: null,
      date: new Date(),
      ...p,
    };
    this.foodLogs.push(log);
    return log;
  }

  addWaterLog(userId: number, amount: number): WaterLog {
    const log: WaterLog = { id: ++this.seq, userId, amount, date: new Date() };
    this.waterLogs.push(log);
    return log;
  }

  addFavorite(userId: number, title: string, items: FavoriteItem[], isShared = false): Favorite {
    const fav: Favorite = { id: ++this.seq, userId, title, items, isShared, createdAt: new Date() };
    this.favorites.push(fav);
    return fav;
  }

  async getDailyStats() {
    return { ...ZERO_TOTALS };
  }
  async getDailyWater() {
    return 0;
  }
  async getDailyWaterLogs() {
    return [];
  }
  async getDailyWorkouts() {
    return [];
  }
  async getFoodLogsInRange(userId: number, start: Date, end: Date) {
    if (this.failRange) throw this.failRange;
    return this.foodLogs.filter((l) => l.userId === userId && l.date! >= start && l.date! <= end);
  }
  async logWater(userId: number, amount: number) {
    this.addWaterLog(userId, amount);
  }
  async createFoodLog(log: Parameters<AppApiStorage["createFoodLog"]>[0]) {
    return this.addFoodLog(log as Partial<FoodLog> & { userId: number; foodName: string });
  }
  async getMonthlyStats() {
    return [];
  }
  /** Дни — как в DatabaseStorage (тот же хелпер), макросы нулевые. */
  async getWeeklyFullStats(_userId: number, tz: string, endKey?: string) {
    const days = endKey ? dayKeysEndingAt(endKey, 7) : lastNDayKeys(new Date(), tz, 7);
    return days.map((date) => ({ date, dayLabel: date, calories: 0, protein: 0, fat: 0, carbs: 0 }));
  }
  async getStreak() {
    return 0;
  }
  async getWeightLogs() {
    return [];
  }
  async updateFoodLog(id: number, userId: number, data: Partial<FoodLog>) {
    const log = this.foodLogs.find((l) => l.id === id && l.userId === userId);
    if (!log) return undefined; // как `.returning()` без строк
    Object.assign(log, data);
    return log;
  }
  async getFoodLogById(id: number, userId: number) {
    return this.foodLogs.find((l) => l.id === id && l.userId === userId);
  }
  async deleteFoodLog(id: number, userId: number) {
    this.foodLogs = this.foodLogs.filter((l) => !(l.id === id && l.userId === userId));
  }
  async deleteWaterLog(id: number, userId: number) {
    const before = this.waterLogs.length;
    this.waterLogs = this.waterLogs.filter((l) => !(l.id === id && l.userId === userId));
    return this.waterLogs.length < before;
  }
  private visible(userId: number, f: Favorite): VisibleFavorite {
    return { ...f, isOwner: f.userId === userId, ownerName: this.users.get(f.userId)?.username ?? null };
  }
  async getVisibleFavorites(userId: number) {
    return this.favorites.filter((f) => f.userId === userId || f.isShared).map((f) => this.visible(userId, f));
  }
  async getFavorites(userId: number) {
    return this.favorites.filter((f) => f.userId === userId);
  }
  async createFavorite(fav: { userId: number; title: string; items: FavoriteItem[] }) {
    return this.addFavorite(fav.userId, fav.title, fav.items);
  }
  async getVisibleFavoriteById(userId: number, id: number) {
    const f = this.favorites.find((x) => x.id === id && (x.userId === userId || x.isShared));
    return f ? this.visible(userId, f) : undefined;
  }
  async setFavoriteShared(userId: number, id: number, isShared: boolean) {
    const f = this.favorites.find((x) => x.id === id && x.userId === userId);
    if (!f) return undefined;
    f.isShared = isShared;
    return f;
  }
  async deleteFavorite(userId: number, id: number) {
    const before = this.favorites.length;
    this.favorites = this.favorites.filter((f) => !(f.id === id && f.userId === userId));
    return this.favorites.length < before;
  }
  async updateUser(id: number, data: Partial<User>) {
    const u = this.users.get(id)!;
    Object.assign(u, data);
    return u;
  }
  async calculateAndSetGoals(userId: number) {
    return this.users.get(userId)!;
  }
  async getBarcodeProduct(barcode: string) {
    return this.barcodeProducts.get(barcode);
  }
  async upsertBarcodeProduct(p: InsertBarcodeProduct) {
    const row: BarcodeProduct = { ...p, hydrating: p.hydrating ?? false, createdAt: new Date() };
    this.barcodeProducts.set(p.barcode, row);
    return row;
  }
}

// ─── Harness ─────────────────────────────────────────────────────────────────

const ALICE_TG = 1001;
const BOB_TG = 1002;

function seed() {
  const s = new FakeStorage();
  s.addUser(makeUser({ id: 1, telegramId: String(ALICE_TG), username: "alice", quickToken: "SECRET-QUICK-TOKEN" }));
  s.addUser(makeUser({ id: 2, telegramId: String(BOB_TG), username: "bob" }));
  s.addUser(makeUser({ id: 3, telegramId: "1003", isBlocked: true }));
  s.addUser(makeUser({ id: 4, telegramId: "1004", isApproved: false }));
  s.addUser(makeUser({ id: 5, telegramId: "1005", isApproved: false, isAdmin: true }));
  return s;
}

type Harness = {
  storage: FakeStorage;
  analyzeCalls: number;
  call: (method: string, path: string, opts?: { tg?: number | null; auth?: string; body?: unknown }) => Promise<{ status: number; json: any; text: string }>;
  close: () => Promise<void>;
};

async function startHarness(storage = seed(), analyzer?: Partial<AppApiDeps>): Promise<Harness> {
  const h = { storage, analyzeCalls: 0 } as Harness;
  const fakeAnalyze = async () => {
    h.analyzeCalls++;
    return [{ foodName: "яблоко", calories: 52, protein: 0, fat: 0, carbs: 14, weight: 100, mealType: "snack" }];
  };
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(
    "/api/app",
    createAppApiRouter({
      storage,
      auth: createTelegramAuth(() => ({ botToken: TEST_TOKEN, storage })),
      analyzeFoodText: fakeAnalyze,
      analyzeFoodImage: fakeAnalyze,
      // Без zxing, LLM и сети: по умолчанию штрихкода нет, OFF не знает ничего.
      decodeBarcode: async () => null,
      detectBarcodeAi: async () => null,
      lookupBarcodeOff: async () => null,
      transcribeAudio: async () => ({ text: "гречка 200 грамм" }),
      // Своя квота на каждый сервер, с запасом: общий экземпляр процесса тесты
      // не трогают (кроме теста, который проверяет именно его).
      aiQuota: createAiQuota({ dailyRequests: 1_000_000, dailyPhotos: 1_000_000 }),
      ...analyzer,
    }),
  );
  const server = await new Promise<Server>((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  const { port } = server.address() as AddressInfo;

  h.call = async (method, path, opts = {}) => {
    const headers: Record<string, string> = {};
    const tg = opts.tg === undefined ? ALICE_TG : opts.tg;
    if (opts.auth !== undefined) headers.authorization = opts.auth;
    else if (tg !== null) headers.authorization = `tma ${buildInitData(TEST_TOKEN, { user: { id: tg, first_name: "T" } })}`;
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`http://127.0.0.1:${port}/api/app${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* не JSON */
    }
    return { status: res.status, json, text };
  };
  h.close = () => new Promise((resolve) => server.close(() => resolve()));
  return h;
}

/** Общий сервер для тестов без побочных эффектов на лимиты. */
let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

const validItem = {
  foodName: "Гречка",
  calories: 330,
  protein: 12,
  fat: 3,
  carbs: 62,
  weight: 250,
  mealType: "lunch",
  fiber: 4.5,
};

// ─── Auth ────────────────────────────────────────────────────────────────────

describe("auth", () => {
  test("без Authorization → 401 missing_init_data", async () => {
    const r = await h.call("GET", "/me", { tg: null });
    assert.equal(r.status, 401);
    assert.equal(r.json.reason, "missing_init_data");
  });

  test("битая подпись → 401 invalid_hash", async () => {
    const good = buildInitData(TEST_TOKEN, { user: { id: ALICE_TG } });
    const broken = good.replace(/hash=[0-9a-f]+/, "hash=" + "0".repeat(64));
    const r = await h.call("GET", "/me", { auth: `tma ${broken}` });
    assert.equal(r.status, 401);
    assert.equal(r.json.reason, "invalid_hash");
  });

  test("подпись чужим токеном → 401", async () => {
    const r = await h.call("GET", "/me", { auth: `tma ${buildInitData("999:OTHER", { user: { id: ALICE_TG } })}` });
    assert.equal(r.status, 401);
  });

  test("другая схема (Bearer) → 401", async () => {
    const r = await h.call("GET", "/me", { auth: `Bearer ${buildInitData(TEST_TOKEN, { user: { id: ALICE_TG } })}` });
    assert.equal(r.status, 401);
  });

  test("незарегистрированный → 403 not_registered", async () => {
    const r = await h.call("GET", "/me", { tg: 9999 });
    assert.equal(r.status, 403);
    assert.equal(r.json.reason, "not_registered");
  });

  test("заблокированный → 403 blocked", async () => {
    const r = await h.call("GET", "/me", { tg: 1003 });
    assert.equal(r.status, 403);
    assert.equal(r.json.reason, "blocked");
  });

  test("не одобренный → 403 not_approved", async () => {
    const r = await h.call("GET", "/day", { tg: 1004 });
    assert.equal(r.status, 403);
    assert.equal(r.json.reason, "not_approved");
  });

  test("админ без одобрения проходит", async () => {
    const r = await h.call("GET", "/me", { tg: 1005 });
    assert.equal(r.status, 200);
  });
});

// ─── /me, /day ───────────────────────────────────────────────────────────────

describe("GET /me", () => {
  test("профиль без quickToken, telegramId и флагов доступа", async () => {
    const r = await h.call("GET", "/me");
    assert.equal(r.status, 200);
    assert.ok(!("quickToken" in r.json));
    assert.ok(!("telegramId" in r.json));
    assert.ok(!("isAdmin" in r.json));
    assert.ok(!r.text.includes("SECRET-QUICK-TOKEN"), "quickToken утёк в ответ");
    assert.ok(r.json.goals && "calories" in r.json.goals);
  });
});

describe("GET /day", () => {
  test("без даты — сегодня в таймзоне пользователя, только свои записи", async () => {
    const own = h.storage.addFoodLog({ userId: 1, foodName: "мой завтрак" });
    const foreign = h.storage.addFoodLog({ userId: 2, foodName: "чужой завтрак" });
    const r = await h.call("GET", "/day");
    assert.equal(r.status, 200);
    assert.equal(r.json.date, todayKey(new Date(), "Europe/Moscow"));
    const ids = r.json.foodLogs.map((l: FoodLog) => l.id);
    assert.ok(ids.includes(own.id));
    assert.ok(!ids.includes(foreign.id), "в чужой день попала чужая запись");
  });

  test("с датой — записи этого дня", async () => {
    const log = h.storage.addFoodLog({ userId: 1, foodName: "январь", date: new Date("2026-01-15T09:00:00Z") });
    const r = await h.call("GET", "/day?date=2026-01-15");
    assert.equal(r.status, 200);
    assert.equal(r.json.date, "2026-01-15");
    assert.deepEqual(r.json.foodLogs.map((l: FoodLog) => l.id), [log.id]);
  });

  test("несуществующая дата → 400", async () => {
    for (const date of ["2026-02-31", "2026-13-01"]) {
      const r = await h.call("GET", `/day?date=${date}`);
      assert.equal(r.status, 400, date);
      assert.equal(r.json.error, "validation_error");
    }
  });

  test("неверный формат даты → 400", async () => {
    const r = await h.call("GET", "/day?date=15.01.2026");
    assert.equal(r.status, 400);
  });
});

// ─── Владение ────────────────────────────────────────────────────────────────

describe("чужие записи", () => {
  test("PATCH чужой записи еды → 404, запись не меняется", async () => {
    const foreign = h.storage.addFoodLog({ userId: 2, foodName: "bob", calories: 100 });
    const r = await h.call("PATCH", `/logs/${foreign.id}`, { body: { calories: 999 } });
    assert.equal(r.status, 404);
    assert.equal(foreign.calories, 100);
  });

  test("PATCH своей записи → 200", async () => {
    const own = h.storage.addFoodLog({ userId: 1, foodName: "alice", calories: 100 });
    const r = await h.call("PATCH", `/logs/${own.id}`, { body: { calories: 150 } });
    assert.equal(r.status, 200);
    assert.equal(r.json.calories, 150);
  });

  test("DELETE чужой записи еды → 404, запись на месте", async () => {
    const foreign = h.storage.addFoodLog({ userId: 2, foodName: "bob" });
    const r = await h.call("DELETE", `/logs/${foreign.id}`);
    assert.equal(r.status, 404);
    assert.ok(h.storage.foodLogs.some((l) => l.id === foreign.id));
  });

  test("repeat чужой записи → 404, в дневник ничего не пишется", async () => {
    const foreign = h.storage.addFoodLog({ userId: 2, foodName: "bob" });
    const before = h.storage.foodLogs.length;
    const r = await h.call("POST", `/logs/${foreign.id}/repeat`);
    assert.equal(r.status, 404);
    assert.equal(h.storage.foodLogs.length, before);
  });

  test("DELETE чужой воды → 404, запись на месте", async () => {
    const foreign = h.storage.addWaterLog(2, 250);
    const r = await h.call("DELETE", `/water/${foreign.id}`);
    assert.equal(r.status, 404);
    assert.ok(h.storage.waterLogs.some((l) => l.id === foreign.id));
  });

  test("DELETE своей воды → 200", async () => {
    const own = h.storage.addWaterLog(1, 250);
    const r = await h.call("DELETE", `/water/${own.id}`);
    assert.equal(r.status, 200);
    assert.ok(!h.storage.waterLogs.some((l) => l.id === own.id));
  });

  test("id не число → 400", async () => {
    for (const [method, path] of [["PATCH", "/logs/abc"], ["DELETE", "/logs/-1"], ["DELETE", "/water/1.5"]] as const) {
      const r = await h.call(method, path, { body: method === "PATCH" ? { calories: 1 } : undefined });
      assert.equal(r.status, 400, `${method} ${path}`);
    }
  });
});

// ─── POST /logs ──────────────────────────────────────────────────────────────

describe("POST /logs", () => {
  test("мусор в теле → 400 validation_error, ничего не записано", async () => {
    const before = h.storage.foodLogs.length;
    const bodies: unknown[] = [
      {},
      { items: [] },
      { items: "x" },
      { items: [{ foodName: "x" }] },
      { items: [{ ...validItem, calories: "330" }] },
      { items: [{ ...validItem, mealType: "brunch" }] },
      { items: [{ ...validItem, foodName: "" }] },
      { items: [{ ...validItem, calories: -1 }] },
      { items: [{ ...validItem, userId: 2 }] },
      { items: [validItem], extra: true },
      { items: Array.from({ length: 21 }, () => validItem) },
    ];
    for (const body of bodies) {
      const r = await h.call("POST", "/logs", { body });
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
      assert.equal(r.json.error, "validation_error");
    }
    assert.equal(h.storage.foodLogs.length, before);
  });

  test("валидное тело → 201, запись текущего пользователя, вода отдельно", async () => {
    const water = { ...validItem, foodName: "Вода", hydrating: true, weight: 300 };
    const r = await h.call("POST", "/logs", { body: { items: [validItem, water] } });
    assert.equal(r.status, 201);
    assert.equal(r.json.createdFood.length, 1);
    assert.equal(r.json.waterAdded, 300);
    const saved = h.storage.foodLogs.find((l) => l.id === r.json.createdFood[0].id)!;
    assert.equal(saved.userId, 1);
    assert.equal(saved.fiber, 4.5);
    assert.equal(saved.mealType, "lunch");
    assert.equal(r.json.day.date, todayKey(new Date(), "Europe/Moscow"));
  });
});

// ─── Избранное ───────────────────────────────────────────────────────────────

describe("избранное", () => {
  const item: FavoriteItem = { foodName: "Овсянка", calories: 300, protein: 10, fat: 5, carbs: 50, weight: 250 };

  test("создание, дедуп по названию, видимость общих и приватных", async () => {
    const s = seed();
    const local = await startHarness(s);
    try {
      const bobPrivate = s.addFavorite(2, "Секрет Боба", [item], false);
      const bobShared = s.addFavorite(2, "Общий Боба", [item], true);

      const created = await local.call("POST", "/favorites", { body: { title: "Завтрак", items: [item] } });
      assert.equal(created.status, 201);
      assert.equal(created.json.isOwner, true);
      assert.equal(created.json.isShared, false);

      const dup = await local.call("POST", "/favorites", { body: { title: "  завтрак ", items: [item] } });
      assert.equal(dup.status, 200);
      assert.equal(dup.json.id, created.json.id);

      const list = await local.call("GET", "/favorites");
      const ids = list.json.favorites.map((f: { id: number }) => f.id);
      assert.ok(ids.includes(created.json.id));
      assert.ok(ids.includes(bobShared.id));
      assert.ok(!ids.includes(bobPrivate.id), "чужое приватное видно в списке");
      const shared = list.json.favorites.find((f: { id: number }) => f.id === bobShared.id);
      assert.equal(shared.isOwner, false);
      assert.equal(shared.ownerName, "bob");
      assert.ok(!("userId" in shared), "в ответ уехал userId владельца");
    } finally {
      await local.close();
    }
  });

  test("невалидное избранное → 400", async () => {
    for (const body of [{ title: "", items: [item] }, { title: "x", items: [] }, { title: "x", items: [{ ...item, calories: "1" }] }, { title: "x", items: [item], isShared: true }]) {
      const r = await h.call("POST", "/favorites", { body });
      assert.equal(r.status, 400, JSON.stringify(body));
    }
  });

  test("использование: своё и чужое общее — в свой дневник, чужое приватное → 404", async () => {
    const s = seed();
    const local = await startHarness(s);
    try {
      const bobPrivate = s.addFavorite(2, "Секрет Боба", [item], false);
      const bobShared = s.addFavorite(2, "Общий Боба", [item], true);

      const denied = await local.call("POST", `/favorites/${bobPrivate.id}/log`);
      assert.equal(denied.status, 404);
      assert.equal(s.foodLogs.length, 0);

      const ok = await local.call("POST", `/favorites/${bobShared.id}/log`);
      assert.equal(ok.status, 201);
      assert.equal(ok.json.createdFood.length, 1);
      assert.equal(s.foodLogs.length, 1);
      assert.equal(s.foodLogs[0].userId, 1, "запись ушла не в дневник вызвавшего");
    } finally {
      await local.close();
    }
  });

  test("шаринг меняет только владелец: чужое общее → 403, чужое приватное → 404", async () => {
    const s = seed();
    const local = await startHarness(s);
    try {
      const bobPrivate = s.addFavorite(2, "Секрет Боба", [item], false);
      const bobShared = s.addFavorite(2, "Общий Боба", [item], true);
      const own = s.addFavorite(1, "Моё", [item], false);

      const r403 = await local.call("PATCH", `/favorites/${bobShared.id}`, { body: { isShared: false } });
      assert.equal(r403.status, 403);
      assert.equal(bobShared.isShared, true);

      const r404 = await local.call("PATCH", `/favorites/${bobPrivate.id}`, { body: { isShared: true } });
      assert.equal(r404.status, 404);
      assert.equal(bobPrivate.isShared, false);

      const bad = await local.call("PATCH", `/favorites/${own.id}`, { body: { isShared: "yes" } });
      assert.equal(bad.status, 400);

      const ok = await local.call("PATCH", `/favorites/${own.id}`, { body: { isShared: true } });
      assert.equal(ok.status, 200);
      assert.equal(ok.json.isShared, true);

      const bobView = await local.call("GET", "/favorites", { tg: BOB_TG });
      assert.ok(bobView.json.favorites.some((f: { id: number; isOwner: boolean }) => f.id === own.id && !f.isOwner));
    } finally {
      await local.close();
    }
  });

  test("DELETE чужого избранного → 404, запись на месте", async () => {
    const s = seed();
    const local = await startHarness(s);
    try {
      const bobPrivate = s.addFavorite(2, "Секрет Боба", [item], false);
      const bobShared = s.addFavorite(2, "Общий Боба", [item], true);
      const own = s.addFavorite(1, "Моё", [item], false);
      for (const fav of [bobPrivate, bobShared]) {
        const r = await local.call("DELETE", `/favorites/${fav.id}`);
        assert.equal(r.status, 404, fav.title);
      }
      assert.equal(s.favorites.filter((f) => f.userId === 2).length, 2);

      const ok = await local.call("DELETE", `/favorites/${own.id}`);
      assert.equal(ok.status, 200);
      assert.ok(!s.favorites.some((f) => f.id === own.id));
    } finally {
      await local.close();
    }
  });
});

// ─── PATCH /profile, /settings ───────────────────────────────────────────────

describe("PATCH /profile и /settings", () => {
  test("профиль: значения вне диапазона и лишние поля → 400, пользователь не меняется", async () => {
    const bodies: unknown[] = [
      {},
      { age: 0 },
      { age: 121 },
      { age: "30" },
      { age: 30.5 },
      { weight: 19 },
      { weight: 401 },
      { height: 281 },
      { caloriesGoal: 499 },
      { carbsGoal: 2001 },
      { gender: "other" },
      { activityLevel: "extreme" },
      { isAdmin: true },
      { quickToken: "x" },
    ];
    for (const body of bodies) {
      const r = await h.call("PATCH", "/profile", { body });
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    const alice = h.storage.users.get(1)!;
    assert.equal(alice.age, null);
    assert.equal(alice.isAdmin, false);
  });

  test("профиль: валидное значение сохраняется, ответ без quickToken", async () => {
    const r = await h.call("PATCH", "/profile", { body: { age: 30, weight: 70 } });
    assert.equal(r.status, 200);
    assert.equal(r.json.age, 30);
    assert.equal(h.storage.users.get(1)!.weight, 70);
    assert.ok(!("quickToken" in r.json));
  });

  test("настройки: неверные значения → 400", async () => {
    const bodies: unknown[] = [
      {},
      { reportTime: "25:00" },
      { reportTime: "9:00" },
      { breakfastReminder: "never" },
      { mealBreakfastEnd: "off" },
      { timezone: "Mars/Olympus" },
      { weightReminderDays: "7" },
      { weightReminderDays: "1,,3" },
      { showMicronutrients: "true" },
      { isBlocked: false },
    ];
    for (const body of bodies) {
      const r = await h.call("PATCH", "/settings", { body });
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.equal(h.storage.users.get(1)!.timezone, "Europe/Moscow");
  });

  test("настройки: валидные значения сохраняются", async () => {
    const r = await h.call("PATCH", "/settings", {
      body: { reportTime: "off", weightReminderDays: "1,3,5", timezone: "Asia/Yekaterinburg", showMicronutrients: true },
    });
    assert.equal(r.status, 200);
    const alice = h.storage.users.get(1)!;
    assert.equal(alice.timezone, "Asia/Yekaterinburg");
    assert.equal(alice.weightReminderDays, "1,3,5");
    // Вернём зону, чтобы остальные тесты считали «сегодня» по Москве.
    alice.timezone = "Europe/Moscow";
  });
});

// ─── /analyze ────────────────────────────────────────────────────────────────

describe("POST /analyze", () => {
  test("невалидное тело → 400, анализатор не вызывается", async () => {
    const local = await startHarness();
    try {
      for (const body of [{}, { text: "   " }, { text: "a", imageBase64: "QUJD" }, { imageBase64: "не base64!" }, { text: "a", x: 1 }]) {
        const r = await local.call("POST", "/analyze", { body });
        assert.equal(r.status, 400, JSON.stringify(body));
      }
      assert.equal(local.analyzeCalls, 0);
    } finally {
      await local.close();
    }
  });

  test("не распознано → 422", async () => {
    const local = await startHarness(seed(), { analyzeFoodText: async () => [] });
    try {
      const r = await local.call("POST", "/analyze", { body: { text: "что-то" } });
      assert.equal(r.status, 422);
      assert.equal(r.json.error, "unrecognized");
    } finally {
      await local.close();
    }
  });

  test("лимит 10 в минуту на пользователя: 11-й → 429, другой пользователь не задет", async () => {
    const local = await startHarness();
    try {
      for (let i = 0; i < 10; i++) {
        const r = await local.call("POST", "/analyze", { body: { text: "яблоко" } });
        assert.equal(r.status, 200, `запрос ${i + 1}`);
        assert.equal(r.json.items.length, 1);
      }
      const limited = await local.call("POST", "/analyze", { body: { text: "яблоко" } });
      assert.equal(limited.status, 429);
      assert.equal(limited.json.error, "rate_limited");
      assert.equal(local.analyzeCalls, 10, "анализатор вызван сверх лимита");

      const bob = await local.call("POST", "/analyze", { tg: BOB_TG, body: { text: "яблоко" } });
      assert.equal(bob.status, 200);

      // Остальные роуты лимит анализа не трогает.
      const day = await local.call("GET", "/day");
      assert.equal(day.status, 200);
    } finally {
      await local.close();
    }
  });
});

// ─── /analyze: штрихкод ──────────────────────────────────────────────────────

describe("POST /analyze: штрихкод", () => {
  const EAN = "4600682000037";
  const IMG = "QUJD";
  const cached: InsertBarcodeProduct = {
    barcode: EAN,
    foodName: "Кефир 2,5%",
    caloriesPer100: 50,
    proteinPer100: 3,
    fatPer100: 2.5,
    carbsPer100: 4,
    defaultWeight: 200,
    hydrating: false,
    source: "off",
  };

  /** Счётчики вызовов фейков и подсказка, с которой позвали vision. */
  function spies() {
    return { decode: 0, detectAi: 0, off: 0, vision: 0, hint: undefined as unknown };
  }
  function barcodeDeps(sp: ReturnType<typeof spies>, opts: { decoded?: string | null; ai?: string | null; off?: any } = {}): Partial<AppApiDeps> {
    return {
      decodeBarcode: async () => {
        sp.decode++;
        return opts.decoded ?? null;
      },
      detectBarcodeAi: async () => {
        sp.detectAi++;
        return opts.ai ?? null;
      },
      lookupBarcodeOff: async () => {
        sp.off++;
        return opts.off ?? null;
      },
      analyzeFoodImage: async (_img, _now, _bounds, hint) => {
        sp.vision++;
        sp.hint = hint;
        return [{ foodName: "Тарелка", calories: 400, protein: 20, fat: 10, carbs: 50, weight: 300, mealType: "lunch" }];
      },
    };
  }

  test("photo + штрихкод в кэше → source barcode, vision не вызван, items проходят analyzedItemSchema", async () => {
    const s = seed();
    await s.upsertBarcodeProduct(cached);
    const sp = spies();
    const local = await startHarness(s, barcodeDeps(sp, { decoded: EAN }));
    try {
      const r = await local.call("POST", "/analyze", { body: { imageBase64: IMG } });
      assert.equal(r.status, 200);
      assert.equal(r.json.source, "barcode");
      assert.equal(sp.vision, 0);
      assert.equal(sp.detectAi, 0, "в режиме photo AI-поиск штрихкода не нужен");
      assert.equal(r.json.items.length, 1);
      const item = r.json.items[0];
      assert.equal(item.foodName, "Кефир 2,5%");
      assert.equal(item.calories, 100);
      assert.notEqual(item.mealType, "snack", "mealType должен считаться по времени");
      for (const it of r.json.items) analyzedItemSchema.parse(it);
      // Ответ можно сразу отправить в POST /logs.
      const saved = await local.call("POST", "/logs", { body: { items: r.json.items } });
      assert.equal(saved.status, 201);
    } finally {
      await local.close();
    }
  });

  test("photo + штрихкод из OFF → source barcode, запись в кэш, items без лишних полей", async () => {
    const s = seed();
    const sp = spies();
    const off = {
      foodName: "Сок яблочный", calories: 92, protein: 0, fat: 0, carbs: 22, weight: 200,
      mealType: "snack", hydrating: false, barcode: EAN, foundInDb: true,
    };
    const local = await startHarness(s, barcodeDeps(sp, { decoded: EAN, off }));
    try {
      const r = await local.call("POST", "/analyze", { body: { imageBase64: IMG } });
      assert.equal(r.status, 200);
      assert.equal(r.json.source, "barcode");
      assert.equal(sp.vision, 0);
      const item = r.json.items[0];
      assert.ok(!("barcode" in item) && !("foundInDb" in item), JSON.stringify(item));
      analyzedItemSchema.parse(item);
      assert.equal(s.barcodeProducts.get(EAN)?.source, "off");
    } finally {
      await local.close();
    }
  });

  test("photo без штрихкода → обычный vision без подсказки, source vision", async () => {
    const sp = spies();
    const local = await startHarness(seed(), barcodeDeps(sp));
    try {
      const r = await local.call("POST", "/analyze", { body: { imageBase64: IMG } });
      assert.equal(r.status, 200);
      assert.equal(r.json.source, "vision");
      assert.equal(sp.decode, 1);
      assert.equal(sp.detectAi, 0);
      assert.equal(sp.vision, 1);
      assert.equal(sp.hint, undefined);
      for (const it of r.json.items) analyzedItemSchema.parse(it);
    } finally {
      await local.close();
    }
  });

  test("vision с дробной оценкой и длинным советом → items всё равно проходят analyzedItemSchema", async () => {
    const sp = spies();
    const deps = barcodeDeps(sp);
    deps.analyzeFoodImage = async () => [
      {
        foodName: "Пицца", calories: 800, protein: 30, fat: 35, carbs: 90, weight: 300, mealType: "dinner",
        foodScore: 3.6, nutritionAdvice: "а".repeat(700),
      },
    ];
    const local = await startHarness(seed(), deps);
    try {
      const r = await local.call("POST", "/analyze", { body: { imageBase64: IMG } });
      assert.equal(r.status, 200);
      const item = analyzedItemSchema.parse(r.json.items[0]);
      assert.equal(item.foodScore, 4);
      assert.equal(item.nutritionAdvice?.length, 500);
    } finally {
      await local.close();
    }
  });

  test("photo при barcodeScanEnabled=false → decode не вызывается", async () => {
    const s = seed();
    s.users.get(1)!.barcodeScanEnabled = false;
    const sp = spies();
    const local = await startHarness(s, barcodeDeps(sp, { decoded: EAN }));
    try {
      const r = await local.call("POST", "/analyze", { body: { imageBase64: IMG, mode: "photo" } });
      assert.equal(r.status, 200);
      assert.equal(r.json.source, "vision");
      assert.equal(sp.decode, 0);
      assert.equal(sp.vision, 1);
    } finally {
      await local.close();
    }
  });

  test("photo + штрихкод не в базе → vision с подсказкой", async () => {
    const sp = spies();
    const local = await startHarness(seed(), barcodeDeps(sp, { decoded: EAN }));
    try {
      const r = await local.call("POST", "/analyze", { body: { imageBase64: IMG } });
      assert.equal(r.status, 200);
      assert.equal(r.json.source, "vision");
      assert.deepEqual(sp.hint, { barcode: EAN });
    } finally {
      await local.close();
    }
  });

  test("barcode без штрихкода → 422 no_barcode, vision не вызван", async () => {
    const sp = spies();
    const local = await startHarness(seed(), barcodeDeps(sp, { ai: "1234567890123" /* битая контрольная сумма */ }));
    try {
      const r = await local.call("POST", "/analyze", { body: { imageBase64: IMG, mode: "barcode" } });
      assert.equal(r.status, 422);
      assert.equal(r.json.error, "no_barcode");
      assert.equal(sp.decode, 1);
      assert.equal(sp.detectAi, 1);
      assert.equal(sp.vision, 0);
    } finally {
      await local.close();
    }
  });

  test("barcode + OFF промах → vision получил подсказку с barcode и названием из OFF", async () => {
    const s = seed();
    s.users.get(1)!.barcodeScanEnabled = false; // режим barcode настройку не смотрит
    const sp = spies();
    const local = await startHarness(s, barcodeDeps(sp, { ai: EAN, off: { foundInDb: false, productName: "Кефир" } }));
    try {
      const r = await local.call("POST", "/analyze", { body: { imageBase64: IMG, mode: "barcode" } });
      assert.equal(r.status, 200);
      assert.equal(r.json.source, "vision");
      assert.equal(sp.off, 1);
      assert.deepEqual(sp.hint, { productName: "Кефир", barcode: EAN });
      assert.equal(s.barcodeProducts.size, 0, "vision-результат Mini App в кэш не пишется");
    } finally {
      await local.close();
    }
  });

  test("mode без картинки или с неизвестным значением → 400", async () => {
    const sp = spies();
    const local = await startHarness(seed(), barcodeDeps(sp));
    try {
      for (const body of [{ text: "яблоко", mode: "photo" }, { text: "яблоко", mode: "barcode" }, { imageBase64: IMG, mode: "qr" }]) {
        const r = await local.call("POST", "/analyze", { body });
        assert.equal(r.status, 400, JSON.stringify(body));
      }
      assert.equal(sp.decode + sp.vision, 0);
    } finally {
      await local.close();
    }
  });

  test("текст → source vision, items проходят analyzedItemSchema", async () => {
    const r = await h.call("POST", "/analyze", { body: { text: "яблоко" } });
    assert.equal(r.status, 200);
    assert.equal(r.json.source, "vision");
    for (const it of r.json.items) analyzedItemSchema.parse(it);
  });
});

// ─── /transcribe ─────────────────────────────────────────────────────────────

describe("POST /transcribe", () => {
  const AUDIO = Buffer.from("fake-ogg-bytes").toString("base64");

  test("200 { text }, расшифровщик получил байты и mimeType", async () => {
    let got: { buf: Buffer; mime: string } | null = null;
    const local = await startHarness(seed(), {
      transcribeAudio: async (buf, mime) => {
        got = { buf, mime };
        return { text: "овсянка" };
      },
    });
    try {
      const r = await local.call("POST", "/transcribe", { body: { audioBase64: AUDIO, mimeType: "audio/webm;codecs=opus" } });
      assert.equal(r.status, 200);
      assert.deepEqual(r.json, { text: "овсянка" });
      assert.equal(got!.buf.toString(), "fake-ogg-bytes");
      assert.equal(got!.mime, "audio/webm;codecs=opus");
    } finally {
      await local.close();
    }
  });

  test("пустая расшифровка → 422 unrecognized", async () => {
    for (const text of [null, "", "   "]) {
      const local = await startHarness(seed(), { transcribeAudio: async () => ({ text }) });
      try {
        const r = await local.call("POST", "/transcribe", { body: { audioBase64: AUDIO, mimeType: "audio/ogg" } });
        assert.equal(r.status, 422, String(text));
        assert.equal(r.json.error, "unrecognized");
      } finally {
        await local.close();
      }
    }
  });

  test("длиннее 60 с → 422 too_long", async () => {
    const local = await startHarness(seed(), { transcribeAudio: async () => ({ tooLong: true }) });
    try {
      const r = await local.call("POST", "/transcribe", { body: { audioBase64: AUDIO, mimeType: "audio/mp4" } });
      assert.equal(r.status, 422);
      assert.equal(r.json.error, "too_long");
    } finally {
      await local.close();
    }
  });

  test("невалидное тело → 400, расшифровщик не вызывается", async () => {
    let calls = 0;
    const local = await startHarness(seed(), {
      transcribeAudio: async () => {
        calls++;
        return { text: "x" };
      },
    });
    try {
      const bodies: unknown[] = [
        {},
        { audioBase64: AUDIO },
        { mimeType: "audio/ogg" },
        { audioBase64: "", mimeType: "audio/ogg" },
        { audioBase64: "не base64!", mimeType: "audio/ogg" },
        { audioBase64: "A".repeat(700_004), mimeType: "audio/ogg" },
        { audioBase64: AUDIO, mimeType: "video/mp4" },
        { audioBase64: AUDIO, mimeType: "audio/ogg\nx" },
        { audioBase64: AUDIO, mimeType: "audio/" + "a".repeat(100) },
        { audioBase64: AUDIO, mimeType: "audio/ogg", extra: 1 },
      ];
      for (const body of bodies) {
        const r = await local.call("POST", "/transcribe", { body });
        assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
      }
      assert.equal(calls, 0);
    } finally {
      await local.close();
    }
  });

  test("общий лимит с /analyze: после 10 анализов → 429", async () => {
    const local = await startHarness();
    try {
      for (let i = 0; i < 10; i++) {
        const r = await local.call("POST", "/analyze", { body: { text: "яблоко" } });
        assert.equal(r.status, 200);
      }
      const r = await local.call("POST", "/transcribe", { body: { audioBase64: AUDIO, mimeType: "audio/ogg" } });
      assert.equal(r.status, 429);
    } finally {
      await local.close();
    }
  });
});

// ─── Дневная AI-квота ────────────────────────────────────────────────────────

describe("дневная AI-квота", () => {
  const AUDIO = Buffer.from("fake-ogg-bytes").toString("base64");
  const IMG = "QUJD";
  const TZ = "Europe/Moscow";

  test("исчерпана → 429 quota_exceeded на /analyze и /transcribe, AI не вызывается", async () => {
    let transcribeCalls = 0;
    const quota = createAiQuota({ dailyRequests: 1, dailyPhotos: 1 });
    assert.equal(quota.tryConsume("1", TZ, "request").allowed, true);
    const local = await startHarness(seed(), {
      aiQuota: quota,
      transcribeAudio: async () => {
        transcribeCalls++;
        return { text: "x" };
      },
    });
    try {
      for (const body of [{ text: "яблоко" }, { imageBase64: IMG }, { imageBase64: IMG, mode: "barcode" }]) {
        const r = await local.call("POST", "/analyze", { body });
        assert.equal(r.status, 429, JSON.stringify(body));
        assert.deepEqual(r.json, { error: "quota_exceeded" });
      }
      const t = await local.call("POST", "/transcribe", { body: { audioBase64: AUDIO, mimeType: "audio/ogg" } });
      assert.equal(t.status, 429);
      assert.deepEqual(t.json, { error: "quota_exceeded" });
      assert.equal(local.analyzeCalls, 0);
      assert.equal(transcribeCalls, 0);

      // У другого пользователя своя квота.
      const bob = await local.call("POST", "/analyze", { tg: BOB_TG, body: { text: "яблоко" } });
      assert.equal(bob.status, 200);
    } finally {
      await local.close();
    }
  });

  test("фото списывается из photo, текст и голос — только из requests", async () => {
    const quota = createAiQuota({ dailyRequests: 10, dailyPhotos: 1 });
    const local = await startHarness(seed(), { aiQuota: quota });
    try {
      assert.equal((await local.call("POST", "/analyze", { body: { imageBase64: IMG } })).status, 200);
      assert.deepEqual(quota.usage("1", TZ), { requests: 1, photos: 1 });

      const second = await local.call("POST", "/analyze", { body: { imageBase64: IMG } });
      assert.equal(second.status, 429);
      assert.deepEqual(second.json, { error: "quota_exceeded" });

      assert.equal((await local.call("POST", "/analyze", { body: { text: "яблоко" } })).status, 200);
      assert.equal((await local.call("POST", "/transcribe", { body: { audioBase64: AUDIO, mimeType: "audio/ogg" } })).status, 200);
      assert.deepEqual(quota.usage("1", TZ), { requests: 3, photos: 1 });
    } finally {
      await local.close();
    }
  });

  test("невалидное тело квоту не списывает", async () => {
    const quota = createAiQuota({ dailyRequests: 10, dailyPhotos: 10 });
    const local = await startHarness(seed(), { aiQuota: quota });
    try {
      assert.equal((await local.call("POST", "/analyze", { body: { text: "   " } })).status, 400);
      assert.equal((await local.call("POST", "/transcribe", { body: { audioBase64: AUDIO, mimeType: "video/mp4" } })).status, 400);
      assert.deepEqual(quota.usage("1", TZ), { requests: 0, photos: 0 });
    } finally {
      await local.close();
    }
  });

  test("по умолчанию роутер списывает из общего экземпляра процесса (тот же, что у бота)", async () => {
    const shared = getSharedAiQuota();
    assert.equal(getSharedAiQuota(), shared, "экземпляр один на процесс");
    const before = shared.usage("1", TZ).requests;
    const local = await startHarness(seed(), { aiQuota: undefined });
    try {
      assert.equal((await local.call("POST", "/analyze", { body: { text: "яблоко" } })).status, 200);
      assert.equal(shared.usage("1", TZ).requests, before + 1);
    } finally {
      await local.close();
    }
  });
});

describe("POST /transcribe: занято", () => {
  test("все слоты перекодирования заняты → 503 busy", async () => {
    const local = await startHarness(seed(), { transcribeAudio: async () => ({ busy: true }) });
    try {
      const r = await local.call("POST", "/transcribe", {
        body: { audioBase64: Buffer.from("x").toString("base64"), mimeType: "audio/ogg" },
      });
      assert.equal(r.status, 503);
      assert.deepEqual(r.json, { error: "busy" });
    } finally {
      await local.close();
    }
  });
});

// ─── /stats ──────────────────────────────────────────────────────────────────

describe("GET /stats", () => {
  test("week без end — 7 дней, последний сегодня", async () => {
    const r = await h.call("GET", "/stats?range=week");
    assert.equal(r.status, 200);
    assert.equal(r.json.days.length, 7);
    assert.equal(r.json.days[6].date, todayKey(new Date(), "Europe/Moscow"));
  });

  test("week с end — 7 дней, кончаются end", async () => {
    const r = await h.call("GET", "/stats?range=week&end=2026-03-01");
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.json.days.map((d: { date: string }) => d.date),
      ["2026-02-23", "2026-02-24", "2026-02-25", "2026-02-26", "2026-02-27", "2026-02-28", "2026-03-01"],
    );
  });

  test("end = сегодня допустим, завтра и кривые даты → 400", async () => {
    const today = todayKey(new Date(), "Europe/Moscow");
    const ok = await h.call("GET", `/stats?range=week&end=${today}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.json.days[6].date, today);
    for (const end of [addDaysKey(today, 1), "2026-02-30", "01.03.2026", ""]) {
      const r = await h.call("GET", `/stats?range=week&end=${end}`);
      assert.equal(r.status, 400, end);
    }
  });
});

// ─── Ошибки ──────────────────────────────────────────────────────────────────

describe("ошибки storage", () => {
  test("исключение → 500 internal_error без текста ошибки", async () => {
    const s = seed();
    s.failRange = new Error("connection to 10.0.0.5 failed: password for user bot");
    const local = await startHarness(s);
    const origError = console.error;
    console.error = () => {};
    try {
      const r = await local.call("GET", "/day");
      assert.equal(r.status, 500);
      assert.deepEqual(r.json, { error: "internal_error" });
      assert.ok(!r.text.includes("10.0.0.5"));
    } finally {
      console.error = origError;
      await local.close();
    }
  });
});
