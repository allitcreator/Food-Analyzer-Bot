/**
 * Pure, env-free helpers for goal calculation and progress rendering.
 *
 * Extracted so the logic can be unit-tested without loading the bot,
 * config or database layers. `server/storage.ts` and `server/bot.ts`
 * import from here — this module is the single source of truth.
 */

export type GoalProfile = {
  weight: number;
  height: number;
  age: number;
  gender: string;
  activityLevel: string;
  goal: string;
};

export type Goals = {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
};

const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/**
 * Daily goals via the Mifflin-St Jeor equation.
 * BMR → TDEE (activity multiplier) → goal adjustment (±500 kcal),
 * then macros at 30% protein / 30% fat / 40% carbs.
 */
export function calcGoalsFromProfile(profile: GoalProfile): Goals {
  let bmr = (10 * profile.weight) + (6.25 * profile.height) - (5 * profile.age);
  bmr += profile.gender === "male" ? 5 : -161;

  let calories = Math.round(bmr * (ACTIVITY_MULTIPLIERS[profile.activityLevel] || 1.2));
  if (profile.goal === "lose") calories -= 500;
  else if (profile.goal === "gain") calories += 500;

  const protein = Math.round((calories * 0.3) / 4);
  const fat = Math.round((calories * 0.3) / 9);
  const carbs = Math.round((calories * 0.4) / 4);

  return { calories, protein, fat, carbs };
}

/**
 * Render a text progress bar, e.g. `[█████░░░░░] 50%`.
 * Ratio is clamped to 100%.
 */
export function progressBar(current: number, goal: number, length = 10): string {
  const ratio = Math.min(current / goal, 1);
  const filled = Math.round(ratio * length);
  const empty = length - filled;
  return `[${("█".repeat(filled) + "░".repeat(empty))}] ${Math.round(ratio * 100)}%`;
}
