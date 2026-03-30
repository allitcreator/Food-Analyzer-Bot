/**
 * Helpers for the /health Apple Health sync command.
 * Exported separately so the parsing logic can be unit-tested.
 */

export type ParsedWorkout = {
  type: string;
  durationMin: number | null;
  calories: number;
};

export type ParsedHealthPayload = {
  steps: number | null;
  activeCalories: number | null;
  workouts: ParsedWorkout[];
};

export type HealthParseResult =
  | { ok: true; payload: ParsedHealthPayload }
  | { ok: false; error: string };

/**
 * Parse and validate the JSON argument of the /health command or HTTP webhook body.
 * Accepts either a JSON string or a pre-parsed object (from express req.body).
 * Returns { ok: true, payload } on success or { ok: false, error } on failure.
 */
export function parseHealthPayload(rawText: string | unknown): HealthParseResult {
  let data: unknown;
  if (typeof rawText === "string") {
    try {
      data = JSON.parse(rawText);
    } catch {
      return { ok: false, error: "invalid_json" };
    }
  } else {
    data = rawText;
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, error: "not_object" };
  }

  const obj = data as Record<string, unknown>;

  // --- steps ---
  let steps: number | null = null;
  if ("steps" in obj) {
    const s = obj.steps;
    if (typeof s !== "number" || !Number.isFinite(s) || s < 0) {
      return { ok: false, error: "invalid_steps" };
    }
    steps = Math.round(s);
  }

  // --- active_calories ---
  let activeCalories: number | null = null;
  if ("active_calories" in obj) {
    const ac = obj.active_calories;
    if (typeof ac !== "number" || !Number.isFinite(ac) || ac < 0) {
      return { ok: false, error: "invalid_active_calories" };
    }
    activeCalories = Math.round(ac);
  }

  // --- workouts ---
  const workouts: ParsedWorkout[] = [];
  if ("workouts" in obj) {
    if (!Array.isArray(obj.workouts)) {
      return { ok: false, error: "workouts_not_array" };
    }
    for (const w of obj.workouts) {
      if (!w || typeof w !== "object" || Array.isArray(w)) {
        return { ok: false, error: "workout_not_object" };
      }
      const wo = w as Record<string, unknown>;

      if (typeof wo.type !== "string" || !wo.type.trim()) {
        return { ok: false, error: "workout_missing_type" };
      }
      if (typeof wo.calories !== "number" || !Number.isFinite(wo.calories) || wo.calories < 0) {
        return { ok: false, error: "workout_invalid_calories" };
      }

      let durationMin: number | null = null;
      if ("duration_min" in wo) {
        const dm = wo.duration_min;
        if (typeof dm !== "number" || !Number.isFinite(dm) || dm <= 0) {
          return { ok: false, error: "workout_invalid_duration" };
        }
        durationMin = Math.round(dm);
      }

      workouts.push({
        type: wo.type.trim(),
        durationMin,
        calories: Math.round(wo.calories),
      });
    }
  }

  // Must have at least one entry that can actually be stored.
  // active_calories alone is not storable — it is only used to split step calories.
  const hasSteps = steps !== null && steps > 0;
  const hasWorkouts = workouts.length > 0;
  if (!hasSteps && !hasWorkouts) {
    return { ok: false, error: "no_storable_data" };
  }

  return { ok: true, payload: { steps, activeCalories, workouts } };
}

/**
 * Calculate how many calories to attribute to steps.
 * Steps calories = max(0, active_calories - workout_kcal)
 * If active_calories is unknown, fall back to steps * 0.04.
 */
export function calcStepsCalories(
  steps: number,
  activeCalories: number | null,
  workoutKcal: number
): number {
  return activeCalories !== null
    ? Math.max(0, activeCalories - workoutKcal)
    : Math.round(steps * 0.04);
}
