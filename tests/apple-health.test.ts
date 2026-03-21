/**
 * Integration tests for Apple Health /health command flow.
 * Tests the storage layer that the bot's /health handler uses directly.
 * Uses real DB — creates and cleans up a test user on each run.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { storage } from "../server/storage";

/** Mirrors the step-calorie calculation logic in bot.ts /health handler */
function calcStepsCalories(steps: number, activeCalories: number | null, workoutKcal: number): number {
  return activeCalories !== null
    ? Math.max(0, activeCalories - workoutKcal)
    : Math.round(steps * 0.04);
}

describe("Apple Health /health command — storage layer", () => {
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

  test("only steps — creates one apple_health entry", async () => {
    await storage.deleteWorkoutLogsBySource(testUserId, new Date(), "apple_health");

    const steps = 8000;
    const stepsKcal = calcStepsCalories(steps, 320, 0);

    await storage.createWorkoutLog({
      userId: testUserId,
      description: `${steps.toLocaleString("ru-RU")} шагов`,
      workoutType: "шаги",
      durationMin: null,
      caloriesBurned: stepsKcal,
      source: "apple_health",
    });

    const workouts = await storage.getDailyWorkouts(testUserId, new Date());
    const stepsEntry = workouts.find(w => w.workoutType === "шаги");
    assert.ok(stepsEntry, "steps workout log should exist");
    assert.equal(stepsEntry!.source, "apple_health");
    assert.equal(stepsEntry!.caloriesBurned, 320);
  });

  test("workout + steps — calories split correctly (active_calories − workout_kcal)", async () => {
    await storage.deleteWorkoutLogsBySource(testUserId, new Date(), "apple_health");

    const workoutKcal = 280;
    await storage.createWorkoutLog({
      userId: testUserId,
      description: "Бег 30 мин",
      workoutType: "бег",
      durationMin: 30,
      caloriesBurned: workoutKcal,
      source: "apple_health",
    });

    const stepsKcal = calcStepsCalories(6000, 500, workoutKcal);
    await storage.createWorkoutLog({
      userId: testUserId,
      description: "6 000 шагов",
      workoutType: "шаги",
      durationMin: null,
      caloriesBurned: stepsKcal,
      source: "apple_health",
    });

    const workouts = await storage.getDailyWorkouts(testUserId, new Date());
    const runEntry = workouts.find(w => w.workoutType === "бег");
    const stepsEntry = workouts.find(w => w.workoutType === "шаги");

    assert.ok(runEntry, "run entry should exist");
    assert.ok(stepsEntry, "steps entry should exist");
    assert.equal(runEntry!.caloriesBurned, 280);
    assert.equal(stepsEntry!.caloriesBurned, 220, "steps kcal = 500 − 280 = 220");
    assert.equal(stepsEntry!.source, "apple_health");
  });

  test("idempotent — re-sync replaces all previous apple_health entries", async () => {
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

    // Second sync (re-sync)
    await storage.deleteWorkoutLogsBySource(testUserId, new Date(), "apple_health");
    await storage.createWorkoutLog({
      userId: testUserId,
      description: "9 000 шагов",
      workoutType: "шаги",
      durationMin: null,
      caloriesBurned: 380,
      source: "apple_health",
    });

    const workouts = await storage.getDailyWorkouts(testUserId, new Date());
    const appleEntries = workouts.filter(w => w.source === "apple_health");
    assert.equal(appleEntries.length, 1, "exactly 1 apple_health entry after re-sync");
    assert.equal(appleEntries[0].caloriesBurned, 380);
  });

  test("active_calories < workout_kcal — steps calories clamped to 0", async () => {
    await storage.deleteWorkoutLogsBySource(testUserId, new Date(), "apple_health");

    const workoutKcal = 100;
    await storage.createWorkoutLog({
      userId: testUserId,
      description: "Силовая 60 мин",
      workoutType: "силовая",
      durationMin: 60,
      caloriesBurned: workoutKcal,
      source: "apple_health",
    });

    const stepsKcal = calcStepsCalories(3000, 100, workoutKcal); // 100 − 100 = 0
    await storage.createWorkoutLog({
      userId: testUserId,
      description: "3 000 шагов",
      workoutType: "шаги",
      durationMin: null,
      caloriesBurned: stepsKcal,
      source: "apple_health",
    });

    const workouts = await storage.getDailyWorkouts(testUserId, new Date());
    const stepsEntry = workouts.find(w => w.workoutType === "шаги");
    assert.ok(stepsEntry, "steps entry exists even with 0 calories");
    assert.equal(stepsEntry!.caloriesBurned, 0, "clamped to 0 when active_calories ≤ workout_kcal");
  });

  test("multiple workouts all saved correctly", async () => {
    await storage.deleteWorkoutLogsBySource(testUserId, new Date(), "apple_health");

    const workoutList = [
      { type: "бег",      durationMin: 30, caloriesBurned: 300 },
      { type: "плавание", durationMin: 45, caloriesBurned: 350 },
    ];

    for (const w of workoutList) {
      await storage.createWorkoutLog({
        userId: testUserId,
        description: `${w.type} ${w.durationMin} мин`,
        workoutType: w.type,
        durationMin: w.durationMin,
        caloriesBurned: w.caloriesBurned,
        source: "apple_health",
      });
    }

    const saved = await storage.getDailyWorkouts(testUserId, new Date());
    const appleEntries = saved.filter(w => w.source === "apple_health");
    assert.equal(appleEntries.length, 2, "both workouts saved");

    const runEntry = appleEntries.find(w => w.workoutType === "бег");
    assert.ok(runEntry, "run entry exists");
    assert.equal(runEntry!.caloriesBurned, 300);
  });

  test("deleteWorkoutLogsBySource removes only apple_health, not manual entries", async () => {
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

    // Re-sync: clear apple_health only
    await storage.deleteWorkoutLogsBySource(testUserId, new Date(), "apple_health");

    const workouts = await storage.getDailyWorkouts(testUserId, new Date());
    const manual = workouts.filter(w => w.source === "manual");
    const apple = workouts.filter(w => w.source === "apple_health");

    assert.ok(manual.length >= 1, "manual entry survives apple_health sync");
    assert.equal(apple.length, 0, "apple_health entries cleared after delete");
  });

  test("fallback calorie calc — steps * 0.04 when no active_calories", () => {
    const kcal = calcStepsCalories(5000, null, 0);
    assert.equal(kcal, Math.round(5000 * 0.04)); // 200
  });

  test("calorie clamping — negative result is floored to 0", () => {
    const kcal = calcStepsCalories(1000, 50, 100); // 50 − 100 = −50 → 0
    assert.equal(kcal, 0);
  });
});
