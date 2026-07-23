/**
 * Storage integration tests for the Apple Health /health flow.
 *
 * These require a live PostgreSQL database (DATABASE_URL) because they import
 * server/storage → server/db → server/config. Run via `npm run test:db`.
 * The pure parse/validation tests live in tests/apple-health.test.ts and run
 * without a database via `npm test`.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { parseHealthPayload, calcStepsCalories } from "../server/health-helpers";
import { storage } from "../server/storage";

describe("Apple Health storage integration", () => {
  let testUserId: number;

  before(async () => {
    const user = await storage.createUser({
      telegramId: "test_health_cmd_9999",
      username: "test_health_cmd",
      isApproved: true,
      isAdmin: false,
    });
    testUserId = user.id;
  });

  after(async () => {
    await storage.deleteUser(testUserId);
  });

  test("valid payload: steps only — stores one apple_health entry", async () => {
    await storage.deleteWorkoutLogsBySource(testUserId, new Date(), "apple_health");

    const r = parseHealthPayload('{"steps":8000,"active_calories":320}');
    assert.ok(r.ok);
    if (!r.ok) return;
    const { steps, activeCalories, workouts } = r.payload;
    const workoutKcal = workouts.reduce((s, w) => s + w.calories, 0);
    const stepsKcal = calcStepsCalories(steps!, activeCalories, workoutKcal);

    await storage.createWorkoutLog({
      userId: testUserId,
      description: `${steps!.toLocaleString("ru-RU")} шагов`,
      workoutType: "шаги",
      durationMin: null,
      caloriesBurned: stepsKcal,
      source: "apple_health",
    });

    const saved = await storage.getDailyWorkouts(testUserId, new Date());
    const entry = saved.find(w => w.workoutType === "шаги");
    assert.ok(entry, "steps entry saved");
    assert.equal(entry!.source, "apple_health");
    assert.equal(entry!.caloriesBurned, 320);
  });

  test("valid payload: workouts + steps — correct calorie split", async () => {
    await storage.deleteWorkoutLogsBySource(testUserId, new Date(), "apple_health");

    const r = parseHealthPayload('{"steps":6000,"active_calories":500,"workouts":[{"type":"Бег","duration_min":30,"calories":280}]}');
    assert.ok(r.ok);
    if (!r.ok) return;
    const { steps, activeCalories, workouts } = r.payload;
    const workoutKcal = workouts.reduce((s, w) => s + w.calories, 0);

    for (const w of workouts) {
      await storage.createWorkoutLog({
        userId: testUserId,
        description: w.durationMin ? `${w.type} ${w.durationMin} мин` : w.type,
        workoutType: w.type.toLowerCase(),
        durationMin: w.durationMin,
        caloriesBurned: w.calories,
        source: "apple_health",
      });
    }

    const stepsKcal = calcStepsCalories(steps!, activeCalories, workoutKcal);
    await storage.createWorkoutLog({
      userId: testUserId,
      description: `${steps!.toLocaleString("ru-RU")} шагов`,
      workoutType: "шаги",
      durationMin: null,
      caloriesBurned: stepsKcal,
      source: "apple_health",
    });

    const saved = await storage.getDailyWorkouts(testUserId, new Date());
    const runEntry = saved.find(w => w.workoutType === "бег");
    const stepsEntry = saved.find(w => w.workoutType === "шаги");
    assert.ok(runEntry, "run entry should exist");
    assert.ok(stepsEntry, "steps entry should exist");
    assert.equal(runEntry!.caloriesBurned, 280);
    assert.equal(stepsEntry!.caloriesBurned, 220, "steps kcal = 500 − 280 = 220");
  });

  test("idempotent — re-sync replaces previous apple_health entries", async () => {
    // First sync
    await storage.deleteWorkoutLogsBySource(testUserId, new Date(), "apple_health");
    await storage.createWorkoutLog({
      userId: testUserId,
      description: "5 000 шагов",
      workoutType: "шаги",
      durationMin: null,
      caloriesBurned: 200,
      source: "apple_health",
    });

    // Re-sync
    await storage.deleteWorkoutLogsBySource(testUserId, new Date(), "apple_health");
    await storage.createWorkoutLog({
      userId: testUserId,
      description: "9 000 шагов",
      workoutType: "шаги",
      durationMin: null,
      caloriesBurned: 380,
      source: "apple_health",
    });

    const saved = await storage.getDailyWorkouts(testUserId, new Date());
    const apple = saved.filter(w => w.source === "apple_health");
    assert.equal(apple.length, 1, "exactly 1 entry after re-sync");
    assert.equal(apple[0].caloriesBurned, 380);
  });

  test("deleteWorkoutLogsBySource does not remove manual entries", async () => {
    await storage.deleteWorkoutLogsBySource(testUserId, new Date(), "apple_health");

    await storage.createWorkoutLog({
      userId: testUserId,
      description: "Ручная тренировка",
      workoutType: "силовая",
      durationMin: 30,
      caloriesBurned: 200,
      source: "manual",
    });

    await storage.createWorkoutLog({
      userId: testUserId,
      description: "10 000 шагов",
      workoutType: "шаги",
      durationMin: null,
      caloriesBurned: 400,
      source: "apple_health",
    });

    await storage.deleteWorkoutLogsBySource(testUserId, new Date(), "apple_health");

    const saved = await storage.getDailyWorkouts(testUserId, new Date());
    const manual = saved.filter(w => w.source === "manual");
    const apple = saved.filter(w => w.source === "apple_health");
    assert.ok(manual.length >= 1, "manual entry survives");
    assert.equal(apple.length, 0, "apple_health cleared");
  });
});
