/**
 * Pure unit tests for the Apple Health /health command flow (no DB).
 *
 * Tests parseHealthPayload() and calcStepsCalories() from
 * server/health-helpers.ts. The DB-backed storage integration tests live in
 * tests/apple-health.db.test.ts and run via `npm run test:db`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseHealthPayload, calcStepsCalories } from "../server/health-helpers";

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

  test("steps=0 with workouts is valid (workouts provide storable data)", () => {
    const r = parseHealthPayload('{"steps":0,"active_calories":100,"workouts":[{"type":"Бег","calories":200}]}');
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.payload.steps, 0);
    assert.equal(r.payload.workouts.length, 1);
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

  test("empty object (no fields) → no_storable_data", () => {
    const r = parseHealthPayload('{}');
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "no_storable_data");
  });

  test("empty workouts array + no steps → no_storable_data", () => {
    const r = parseHealthPayload('{"workouts":[]}');
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.equal(r.error, "no_storable_data");
  });

  // active_calories alone is storable since the energy-balance feature
  // (BMR/TDEE from active calories), so these are valid payloads now.
  test("active_calories only (no steps, no workouts) → valid, storable", () => {
    const r = parseHealthPayload('{"active_calories":300}');
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.payload.activeCalories, 300);
    assert.equal(r.payload.steps, null);
    assert.deepEqual(r.payload.workouts, []);
  });

  test("steps=0 + active_calories only → valid, storable", () => {
    const r = parseHealthPayload('{"steps":0,"active_calories":200}');
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.payload.steps, 0);
    assert.equal(r.payload.activeCalories, 200);
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
