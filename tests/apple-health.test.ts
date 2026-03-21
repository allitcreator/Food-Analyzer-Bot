/**
 * Integration + unit tests for Apple Health /health command flow.
 *
 * Section 1: Pure parse/validation tests (no DB) — tests parseHealthPayload()
 *            and calcStepsCalories() from server/health-helpers.ts
 * Section 2: Storage integration tests — tests DB operations that the bot handler uses
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { parseHealthPayload, calcStepsCalories } from "../server/health-helpers";
import { storage } from "../server/storage";

// ─── Section 1: parseHealthPayload — parse / validation ───────────────────────

describe("parseHealthPayload — valid payloads", () => {
  test("steps only", () => {
    const r = parseHealthPayload('{"steps":8000}');
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.payload.steps, 8000);
    assert.equal(r.payload.activeCalories, null);
    assert.deepEqual(r.payload.workouts, []);
  });

  test("active_calories only", () => {
    const r = parseHealthPayload('{"active_calories":420}');
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.payload.steps, null);
    assert.equal(r.payload.activeCalories, 420);
  });

  test("steps + active_calories", () => {
    const r = parseHealthPayload('{"steps":10000,"active_calories":500}');
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.payload.steps, 10000);
    assert.equal(r.payload.activeCalories, 500);
  });

  test("steps + active_calories + one workout", () => {
    const json = '{"steps":9842,"active_calories":430,"workouts":[{"type":"Бег","duration_min":30,"calories":280}]}';
    const r = parseHealthPayload(json);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.payload.workouts.length, 1);
    assert.equal(r.payload.workouts[0].type, "Бег");
    assert.equal(r.payload.workouts[0].durationMin, 30);
    assert.equal(r.payload.workouts[0].calories, 280);
  });

  test("workout without duration_min — durationMin is null", () => {
    const r = parseHealthPayload('{"workouts":[{"type":"Силовая","calories":200}]}');
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.payload.workouts[0].durationMin, null);
  });

  test("multiple workouts", () => {
    const json = '{"active_calories":600,"workouts":[{"type":"Бег","duration_min":30,"calories":300},{"type":"Плавание","duration_min":45,"calories":300}]}';
    const r = parseHealthPayload(json);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.payload.workouts.length, 2);
  });

  test("fractional steps are rounded", () => {
    const r = parseHealthPayload('{"steps":8000.7}');
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.payload.steps, 8001);
  });

  test("fractional calories are rounded", () => {
    const r = parseHealthPayload('{"workouts":[{"type":"Бег","calories":280.6}]}');
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.payload.workouts[0].calories, 281);
  });

  test("zero steps is valid", () => {
    const r = parseHealthPayload('{"steps":0,"active_calories":100}');
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.payload.steps, 0);
  });
});

describe("parseHealthPayload — invalid payloads", () => {
  test("invalid JSON syntax → invalid_json", () => {
    const r = parseHealthPayload("{not valid json");
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "invalid_json");
  });

  test("JSON array instead of object → not_object", () => {
    const r = parseHealthPayload('[{"steps":1000}]');
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "not_object");
  });

  test("JSON string instead of object → not_object", () => {
    const r = parseHealthPayload('"hello"');
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "not_object");
  });

  test("steps is string → invalid_steps", () => {
    const r = parseHealthPayload('{"steps":"8000"}');
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "invalid_steps");
  });

  test("steps is negative → invalid_steps", () => {
    const r = parseHealthPayload('{"steps":-100}');
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "invalid_steps");
  });

  test("steps is NaN (via string 'NaN') — not valid JSON number, so invalid JSON", () => {
    const r = parseHealthPayload('{"steps":NaN}');
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "invalid_json");
  });

  test("steps is Infinity (via string 'Infinity') — invalid JSON", () => {
    const r = parseHealthPayload('{"steps":Infinity}');
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "invalid_json");
  });

  test("active_calories is negative → invalid_active_calories", () => {
    const r = parseHealthPayload('{"steps":5000,"active_calories":-10}');
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "invalid_active_calories");
  });

  test("active_calories is string → invalid_active_calories", () => {
    const r = parseHealthPayload('{"active_calories":"много"}');
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "invalid_active_calories");
  });

  test("workouts is not array → workouts_not_array", () => {
    const r = parseHealthPayload('{"workouts":"Бег 30 мин"}');
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "workouts_not_array");
  });

  test("workout item is null → workout_not_object", () => {
    const r = parseHealthPayload('{"workouts":[null]}');
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "workout_not_object");
  });

  test("workout missing type → workout_missing_type", () => {
    const r = parseHealthPayload('{"workouts":[{"calories":200}]}');
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "workout_missing_type");
  });

  test("workout empty type string → workout_missing_type", () => {
    const r = parseHealthPayload('{"workouts":[{"type":"","calories":200}]}');
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "workout_missing_type");
  });

  test("workout missing calories → workout_invalid_calories", () => {
    const r = parseHealthPayload('{"workouts":[{"type":"Бег"}]}');
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "workout_invalid_calories");
  });

  test("workout negative calories → workout_invalid_calories", () => {
    const r = parseHealthPayload('{"workouts":[{"type":"Бег","calories":-50}]}');
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "workout_invalid_calories");
  });

  test("workout duration_min is 0 → workout_invalid_duration", () => {
    const r = parseHealthPayload('{"workouts":[{"type":"Бег","calories":200,"duration_min":0}]}');
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "workout_invalid_duration");
  });

  test("workout duration_min is negative → workout_invalid_duration", () => {
    const r = parseHealthPayload('{"workouts":[{"type":"Бег","calories":200,"duration_min":-5}]}');
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "workout_invalid_duration");
  });

  test("empty object (no fields) → empty_payload", () => {
    const r = parseHealthPayload('{}');
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "empty_payload");
  });

  test("empty workouts array + no steps/calories → empty_payload", () => {
    const r = parseHealthPayload('{"workouts":[]}');
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "empty_payload");
  });
});

// ─── Section 2: calcStepsCalories ─────────────────────────────────────────────

describe("calcStepsCalories", () => {
  test("returns active_calories − workoutKcal", () => {
    assert.equal(calcStepsCalories(8000, 400, 200), 200);
  });

  test("clamps negative result to 0", () => {
    assert.equal(calcStepsCalories(1000, 50, 200), 0);
  });

  test("fallback steps * 0.04 when activeCalories is null", () => {
    assert.equal(calcStepsCalories(5000, null, 0), Math.round(5000 * 0.04));
  });

  test("zero activeCalories − zero workoutKcal = 0", () => {
    assert.equal(calcStepsCalories(10000, 0, 0), 0);
  });
});

// ─── Section 3: Storage integration — what the bot handler does ───────────────

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
