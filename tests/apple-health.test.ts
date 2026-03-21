/**
 * Integration tests for Apple Health sync.
 * Uses real DB — creates + cleans up test user on each run.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { storage } from "../server/storage";

const BASE = "http://localhost:5000";

async function post(path: string, body: unknown) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Apple Health full flow", () => {
  let testUser: Awaited<ReturnType<typeof storage.createUser>>;
  let token: string;

  before(async () => {
    testUser = await storage.createUser({
      telegramId: "test_apple_health_999",
      username: "test_apple_health",
      isApproved: true,
      isAdmin: false,
    });
    token = await storage.generateHealthToken(testUser.id);
  });

  after(async () => {
    await storage.deleteUser(testUser.id);
  });

  test("generateHealthToken stores token in users table", async () => {
    const found = await storage.getUserByHealthToken(token);
    assert.ok(found, "user should be found by token");
    assert.equal(found!.id, testUser.id);
    assert.equal(found!.healthToken, token);
  });

  test("webhook: only steps, no workouts", async () => {
    const res = await post("/api/health/apple", {
      token,
      steps: 8000,
      active_calories: 320,
    });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.ok, true);
    assert.equal(body.logged, 1);

    const workouts = await storage.getDailyWorkouts(testUser.id, new Date());
    const stepsEntry = workouts.find(w => w.workoutType === "шаги");
    assert.ok(stepsEntry, "steps workout log should exist");
    assert.equal(stepsEntry!.source, "apple_health");
    assert.equal(stepsEntry!.caloriesBurned, 320);
  });

  test("webhook: workouts + steps, calories split correctly", async () => {
    const res = await post("/api/health/apple", {
      token,
      steps: 6000,
      active_calories: 500,
      workouts: [{ type: "Бег", duration_min: 30, calories: 280 }],
    });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.logged, 2);

    const workouts = await storage.getDailyWorkouts(testUser.id, new Date());
    const runEntry = workouts.find(w => w.workoutType === "бег");
    const stepsEntry = workouts.find(w => w.workoutType === "шаги");

    assert.ok(runEntry, "run entry should exist");
    assert.ok(stepsEntry, "steps entry should exist");
    assert.equal(runEntry!.caloriesBurned, 280);
    assert.equal(stepsEntry!.caloriesBurned, 220, "steps calories = 500 - 280 = 220");
    assert.equal(stepsEntry!.source, "apple_health");
  });

  test("webhook: idempotent — re-sync replaces previous apple_health entries", async () => {
    await post("/api/health/apple", { token, steps: 5000, active_calories: 200 });
    await post("/api/health/apple", { token, steps: 9000, active_calories: 380 });

    const workouts = await storage.getDailyWorkouts(testUser.id, new Date());
    const appleEntries = workouts.filter(w => w.source === "apple_health");
    assert.equal(appleEntries.length, 1, "should have exactly 1 apple_health entry after re-sync");
    assert.equal(appleEntries[0].caloriesBurned, 380);
  });

  test("webhook: steps > 0 with zero-attributed calories still creates entry", async () => {
    const res = await post("/api/health/apple", {
      token,
      steps: 3000,
      active_calories: 100,
      workouts: [{ type: "Силовая", duration_min: 60, calories: 100 }],
    });
    assert.equal(res.status, 200);
    const workouts = await storage.getDailyWorkouts(testUser.id, new Date());
    const stepsEntry = workouts.find(w => w.workoutType === "шаги");
    assert.ok(stepsEntry, "steps entry must exist even if calories = 0");
    assert.equal(stepsEntry!.caloriesBurned, 0, "steps calories = 100 - 100 = 0, allowed");
  });

  test("webhook: multiple workouts in one request", async () => {
    const res = await post("/api/health/apple", {
      token,
      active_calories: 600,
      workouts: [
        { type: "Бег", duration_min: 30, calories: 300 },
        { type: "Плавание", duration_min: 45, calories: 300 },
      ],
    });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.logged, 2);
  });

  test("deleteWorkoutLogsBySource removes only apple_health entries", async () => {
    await storage.createWorkoutLog({
      userId: testUser.id,
      description: "Ручная тренировка",
      workoutType: "силовая",
      durationMin: 30,
      caloriesBurned: 200,
      source: "manual",
    });

    await post("/api/health/apple", {
      token,
      steps: 10000,
      active_calories: 400,
    });

    const workouts = await storage.getDailyWorkouts(testUser.id, new Date());
    const manual = workouts.filter(w => w.source === "manual");
    const apple = workouts.filter(w => w.source === "apple_health");

    assert.ok(manual.length >= 1, "manual entries should survive apple_health sync");
    assert.equal(apple.length, 1, "only one apple_health entry after sync");
  });

  test("GET /api/health/setup/:token serves HTML page", async () => {
    const res = await fetch(`${BASE}/api/health/setup/${token}`);
    assert.equal(res.status, 200);
    const ct = res.headers.get("content-type") ?? "";
    assert.ok(ct.includes("text/html"), `Expected HTML, got: ${ct}`);
    const html = await res.text();
    assert.ok(html.includes(token), "setup page should contain the token");
    assert.ok(html.includes("/api/health/apple"), "setup page should contain webhook URL");
    assert.ok(html.includes("Копировать"), "setup page should have copy buttons");
  });
});
