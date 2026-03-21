/**
 * Unit tests for pure logic functions.
 * These don't need a running server or DB.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ─── progressBar ────────────────────────────────────────────────────────────
// Copied from server/bot.ts to test in isolation
function progressBar(current: number, goal: number, length = 10): string {
  const ratio = Math.min(current / goal, 1);
  const filled = Math.round(ratio * length);
  const empty = length - filled;
  return `[${("█".repeat(filled) + "░".repeat(empty))}] ${Math.round(ratio * 100)}%`;
}

describe("progressBar", () => {
  test("empty bar at 0%", () => {
    const bar = progressBar(0, 2000);
    assert.ok(bar.startsWith("[░░░░░░░░░░]"), `got: ${bar}`);
    assert.ok(bar.includes("0%"));
  });

  test("full bar at 100%", () => {
    const bar = progressBar(2000, 2000);
    assert.ok(bar.startsWith("[██████████]"), `got: ${bar}`);
    assert.ok(bar.includes("100%"));
  });

  test("half bar at 50%", () => {
    const bar = progressBar(1000, 2000);
    assert.ok(bar.startsWith("[█████░░░░░]"), `got: ${bar}`);
    assert.ok(bar.includes("50%"));
  });

  test("clamped at 100% when over goal", () => {
    const bar = progressBar(3000, 2000);
    assert.ok(bar.startsWith("[██████████]"), `got: ${bar}`);
    assert.ok(bar.includes("100%"));
  });

  test("custom length works", () => {
    const bar = progressBar(500, 1000, 5);
    // filled=3 (Math.round(2.5)=3), empty=2 → "[███░░] 50%"
    assert.equal(bar, "[███░░] 50%");
  });
});

// ─── Mifflin-St Jeor calorie calculation ────────────────────────────────────
// Matches logic in server/storage.ts calculateAndSetGoals()
function calcCalories(opts: {
  weight: number; height: number; age: number;
  gender: "male" | "female"; activityLevel: string; goal: string;
}): number {
  let bmr = 10 * opts.weight + 6.25 * opts.height - 5 * opts.age;
  bmr += opts.gender === "male" ? 5 : -161;
  const mults: Record<string, number> = {
    sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9,
  };
  let cal = Math.round(bmr * (mults[opts.activityLevel] ?? 1.2));
  if (opts.goal === "lose") cal -= 500;
  else if (opts.goal === "gain") cal += 500;
  return cal;
}

describe("Mifflin-St Jeor calorie calculation", () => {
  test("male, 30y, 80kg, 180cm, moderate, maintain", () => {
    const cal = calcCalories({ weight: 80, height: 180, age: 30, gender: "male", activityLevel: "moderate", goal: "maintain" });
    // BMR = 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780; TDEE = 1780 * 1.55 = 2759
    assert.equal(cal, 2759);
  });

  test("female, 25y, 60kg, 165cm, sedentary, lose", () => {
    const cal = calcCalories({ weight: 60, height: 165, age: 25, gender: "female", activityLevel: "sedentary", goal: "lose" });
    // BMR = 10*60 + 6.25*165 - 5*25 - 161 = 600 + 1031.25 - 125 - 161 = 1345.25; TDEE = 1345 * 1.2 = 1614; -500 = 1114
    assert.ok(cal > 1000 && cal < 1300, `unexpected value: ${cal}`);
  });

  test("gain goal adds 500 kcal vs maintain", () => {
    const maintain = calcCalories({ weight: 70, height: 175, age: 28, gender: "male", activityLevel: "light", goal: "maintain" });
    const gain = calcCalories({ weight: 70, height: 175, age: 28, gender: "male", activityLevel: "light", goal: "gain" });
    assert.equal(gain - maintain, 500);
  });

  test("lose goal removes 500 kcal vs maintain", () => {
    const maintain = calcCalories({ weight: 70, height: 175, age: 28, gender: "male", activityLevel: "light", goal: "maintain" });
    const lose = calcCalories({ weight: 70, height: 175, age: 28, gender: "male", activityLevel: "light", goal: "lose" });
    assert.equal(maintain - lose, 500);
  });
});

// ─── Apple Health calorie-splitting logic ───────────────────────────────────
// Matches logic in server/routes.ts POST /api/health/apple
function computeStepsCalories(
  steps: number,
  active_calories: number | undefined,
  workouts: { calories: number }[],
): number {
  const workoutKcal = workouts.reduce((s, w) => s + w.calories, 0);
  if (active_calories != null) {
    return Math.max(0, active_calories - workoutKcal);
  }
  return Math.round(steps * 0.04);
}

describe("Apple Health steps calorie splitting", () => {
  test("no workouts: uses active_calories directly", () => {
    const cal = computeStepsCalories(8000, 350, []);
    assert.equal(cal, 350);
  });

  test("with workouts: subtracts workout calories", () => {
    const cal = computeStepsCalories(8000, 500, [{ calories: 300 }]);
    assert.equal(cal, 200);
  });

  test("clamped at 0 when workouts exceed active_calories", () => {
    const cal = computeStepsCalories(5000, 100, [{ calories: 100 }]);
    assert.equal(cal, 0, "should be 0, not negative");
  });

  test("fallback to steps * 0.04 when no active_calories", () => {
    const cal = computeStepsCalories(10000, undefined, []);
    assert.equal(cal, 400); // 10000 * 0.04
  });

  test("multiple workouts summed before subtraction", () => {
    const cal = computeStepsCalories(6000, 600, [
      { calories: 200 },
      { calories: 150 },
    ]);
    assert.equal(cal, 250); // 600 - 350
  });
});

// ─── Macros ratio check ──────────────────────────────────────────────────────
// Goals are: protein=30% of cal, fat=30%, carbs=40%
function calcMacros(calories: number) {
  return {
    protein: Math.round((calories * 0.3) / 4),
    fat: Math.round((calories * 0.3) / 9),
    carbs: Math.round((calories * 0.4) / 4),
  };
}

describe("Macro goal ratios", () => {
  test("2000 kcal macros are in reasonable range", () => {
    const m = calcMacros(2000);
    assert.ok(m.protein >= 140 && m.protein <= 160, `protein: ${m.protein}`);
    assert.ok(m.fat >= 60 && m.fat <= 70, `fat: ${m.fat}`);
    assert.ok(m.carbs >= 190 && m.carbs <= 210, `carbs: ${m.carbs}`);
  });

  test("macros scale linearly with calories", () => {
    const m1 = calcMacros(2000);
    const m2 = calcMacros(1000);
    assert.ok(Math.abs(m1.protein / m2.protein - 2) < 0.1, "protein should ~double");
    assert.ok(Math.abs(m1.carbs / m2.carbs - 2) < 0.1, "carbs should ~double");
  });
});
