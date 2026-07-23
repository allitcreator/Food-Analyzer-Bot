/**
 * Pure, env-free BMR / TDEE / energy-balance helpers (Mifflin-St Jeor).
 *
 * These mirror the private helpers in `server/bot.ts` (`calculateBMR`,
 * `calculateTDEE`, `buildEnergyBalanceText`) but return plain numbers instead
 * of formatted Telegram text, so the REST API can serve a structured
 * energyBalance object. `server/bot.ts` is intentionally left untouched.
 */

export type BmrProfile = {
  weight?: number | null;
  height?: number | null;
  age?: number | null;
  gender?: string | null;
  activityLevel?: string | null;
};

const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/** Basal metabolic rate, or null when the profile is incomplete. */
export function calculateBMR(user: BmrProfile): number | null {
  if (!user.weight || !user.height || !user.age || !user.gender) return null;
  const base = 10 * user.weight + 6.25 * user.height - 5 * user.age;
  return Math.round(base + (user.gender === "male" ? 5 : -161));
}

/**
 * Total daily energy expenditure.
 * With tracker data (active calories > 0): BMR + active calories (no multiplier,
 * since Apple Health active calories already represent everything above BMR).
 * Otherwise: BMR × activity-level multiplier.
 */
export function calculateTDEE(user: BmrProfile, activityCalories: number | null): number | null {
  const bmr = calculateBMR(user);
  if (!bmr) return null;
  if (activityCalories !== null && activityCalories > 0) {
    return Math.round(bmr + activityCalories);
  }
  const multiplier = ACTIVITY_MULTIPLIERS[user.activityLevel ?? "sedentary"] ?? 1.2;
  return Math.round(bmr * multiplier);
}

export type EnergyBalance = {
  bmr: number;
  tdee: number;
  eaten: number;
  burnedFromActivity: number;
  balance: number; // eaten - tdee (negative = deficit)
  isDeficit: boolean;
  hasTracker: boolean;
};

/**
 * Structured energy balance, or null when BMR can't be computed
 * (incomplete profile).
 */
export function computeEnergyBalance(
  user: BmrProfile,
  caloriesEaten: number,
  burnedFromActivity: number,
): EnergyBalance | null {
  const bmr = calculateBMR(user);
  if (!bmr) return null;

  const hasTracker = burnedFromActivity > 0;
  const tdee = calculateTDEE(user, hasTracker ? burnedFromActivity : null)!;
  const balance = caloriesEaten - tdee;

  return {
    bmr,
    tdee,
    eaten: caloriesEaten,
    burnedFromActivity,
    balance,
    isDeficit: balance < 0,
    hasTracker,
  };
}
