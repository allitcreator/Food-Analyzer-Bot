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
 * Total daily energy expenditure: BMR × activity-level multiplier.
 */
export function calculateTDEE(user: BmrProfile): number | null {
  const bmr = calculateBMR(user);
  if (!bmr) return null;
  const multiplier = ACTIVITY_MULTIPLIERS[user.activityLevel ?? "sedentary"] ?? 1.2;
  return Math.round(bmr * multiplier);
}

/**
 * Готовый блок «Энергобаланс» для сообщений бота.
 *
 * Живёт здесь, а не в `bot.ts`, вместе с расчётами, на которых держится: там
 * он соседствовал с дословной копией `calculateBMR`/`calculateTDEE`, и любая
 * правка формулы разошлась бы с этим текстом.
 *
 * `compact` — однострочный вид для дневной сводки, где место дороже деталей.
 * Неполный профиль даёт пустую строку: показывать нули вместо расхода значило
 * бы врать пользователю.
 */
export function buildEnergyBalanceText(user: BmrProfile, caloriesEaten: number, compact = false): string {
  const tdee = calculateTDEE(user);
  if (!tdee) return "";

  const balance = caloriesEaten - tdee;
  const isDeficit = balance < 0;

  if (compact) {
    const label = isDeficit ? `✅ Дефицит: ${Math.abs(balance)}` : `🚨 Профицит: +${balance}`;
    return `\n📊 ${label} ккал`;
  }

  let text = `\n📊 Энергобаланс:\n`;
  text += `  🍽 Съедено: ${caloriesEaten} ккал\n`;
  text += `  🔥 Расход по профилю: ${tdee} ккал\n`;
  if (isDeficit) {
    text += `  ✅ Дефицит: ${Math.abs(balance)} ккал`;
  } else if (balance === 0) {
    text += `  ⚖️ Баланс: 0 ккал`;
  } else {
    text += `  🚨 Профицит: +${balance} ккал`;
  }
  return text;
}

export type EnergyBalance = {
  bmr: number;
  tdee: number;
  eaten: number;
  burnedFromActivity: number; // manual workouts, shown as a separate line (doesn't affect balance)
  balance: number; // eaten - tdee (negative = deficit)
  isDeficit: boolean;
};

/**
 * Structured energy balance, or null when BMR can't be computed
 * (incomplete profile). TDEE is always profile-based (activity multiplier);
 * workouts are reported separately via `burnedFromActivity`.
 */
export function computeEnergyBalance(
  user: BmrProfile,
  caloriesEaten: number,
  burnedFromActivity: number,
): EnergyBalance | null {
  const bmr = calculateBMR(user);
  if (!bmr) return null;

  const tdee = calculateTDEE(user)!;
  const balance = caloriesEaten - tdee;

  return {
    bmr,
    tdee,
    eaten: caloriesEaten,
    burnedFromActivity,
    balance,
    isDeficit: balance < 0,
  };
}
