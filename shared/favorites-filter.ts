/**
 * Pure client-side search filter for the Mini App "Избранное" tab.
 *
 * Kept dependency-free and framework-agnostic so it can be reused by the React
 * page and covered by unit tests without a browser. A favorite matches when the
 * (trimmed, case-insensitive) query is a substring of its title or of any of
 * its item names. An empty query matches everything.
 */
export interface SearchableFavorite {
  title: string;
  items: { foodName: string }[];
}

export function matchesFavoriteQuery(fav: SearchableFavorite, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (fav.title.toLowerCase().includes(q)) return true;
  return fav.items.some((it) => it.foodName.toLowerCase().includes(q));
}

export function filterFavorites<T extends SearchableFavorite>(favs: T[], query: string): T[] {
  const q = query.trim();
  if (!q) return favs;
  return favs.filter((f) => matchesFavoriteQuery(f, q));
}
