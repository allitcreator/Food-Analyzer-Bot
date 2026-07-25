/**
 * Pure, env-free helpers for the "repeat meal" + favorites feature.
 *
 * Extracted so the logic can be unit-tested without loading the bot,
 * config or database layers. `server/bot.ts` imports from here.
 */
import type { FavoriteItem } from "@shared/schema";

export type { FavoriteItem };

// How often a dish must be logged (over N days) before we offer to save it.
export const FAVORITE_SUGGEST_THRESHOLD = 3;
export const FAVORITE_SUGGEST_DAYS = 30;

// Max length of an auto-generated meal title (Telegram-friendly, not clipped mid-word).
export const MEAL_TITLE_MAX_LEN = 60;

export type MealBoundaries = { breakfastEnd: string; lunchEnd: string };

/**
 * Default mealType from the wall-clock time, mirroring the AI prompt logic in
 * server/openai.ts (breakfast 05:00–bfEnd, lunch bfEnd–lnEnd, otherwise dinner).
 * Used for "repeat" / favorites, where mealType is assigned by the CURRENT time
 * of the user instead of being copied from the source record.
 */
export function mealTypeByTime(now: Date, boundaries?: MealBoundaries): "breakfast" | "lunch" | "dinner" {
  const totalMin = now.getHours() * 60 + now.getMinutes();

  const bfEnd = boundaries?.breakfastEnd ?? "12:30";
  const lnEnd = boundaries?.lunchEnd ?? "16:30";
  const [bfH, bfM] = bfEnd.split(":").map(Number);
  const [lnH, lnM] = lnEnd.split(":").map(Number);
  const bfEndMin = bfH * 60 + bfM;
  const lnEndMin = lnH * 60 + lnM;

  if (totalMin >= 300 && totalMin <= bfEndMin) return "breakfast";
  if (totalMin > bfEndMin && totalMin <= lnEndMin) return "lunch";
  return "dinner";
}

/**
 * Build a favorite title from item names: "Название1 + Название2 …",
 * trimmed to a sane length without cutting a name in half. When the joined
 * string is too long, keep as many whole names as fit and append " …".
 */
export function buildMealTitle(names: string[], maxLen: number = MEAL_TITLE_MAX_LEN): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return "Приём пищи";

  const full = clean.join(" + ");
  if (full.length <= maxLen) return full;

  // Keep whole names while they fit; mark the rest with an ellipsis.
  const kept: string[] = [];
  for (const name of clean) {
    const candidate = [...kept, name].join(" + ");
    if (candidate.length + 2 > maxLen) break; // +2 leaves room for " …"
    kept.push(name);
  }
  if (kept.length === 0) {
    // A single very long name — hard-truncate it.
    return clean[0].slice(0, Math.max(1, maxLen - 1)).trimEnd() + "…";
  }
  return kept.join(" + ") + " …";
}

/**
 * Project arbitrary food/pending items down to the persisted FavoriteItem shape,
 * dropping macros/advice we don't store and normalizing numbers to integers.
 */
export function toFavoriteItems(items: Array<Record<string, any>>): FavoriteItem[] {
  return items.map((it) => {
    const fav: FavoriteItem = {
      foodName: String(it.foodName ?? ""),
      calories: Math.round(Number(it.calories)) || 0,
      protein: Math.round(Number(it.protein)) || 0,
      fat: Math.round(Number(it.fat)) || 0,
      carbs: Math.round(Number(it.carbs)) || 0,
      weight: Math.round(Number(it.weight)) || 0,
    };
    if (it.hydrating) fav.hydrating = true;
    return fav;
  });
}

/** Case-insensitive, whitespace-tolerant title equality (for de-duplicating). */
export function sameTitle(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Should we offer to save `title` as a favorite? Only when the dish is logged
 * often enough, is not already a favorite, and wasn't dismissed this session.
 */
export function shouldSuggestFavorite(params: {
  title: string;
  recentCount: number;
  existingTitles: string[];
  dismissedTitles: string[];
  threshold?: number;
}): boolean {
  const threshold = params.threshold ?? FAVORITE_SUGGEST_THRESHOLD;
  if (params.recentCount < threshold) return false;
  if (params.existingTitles.some((t) => sameTitle(t, params.title))) return false;
  if (params.dismissedTitles.some((t) => sameTitle(t, params.title))) return false;
  return true;
}
