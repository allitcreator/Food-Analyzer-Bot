/**
 * Pure helpers for serving the built Mini App (dist/public) safely behind the
 * Telegram WebView, which aggressively caches index.html.
 *
 * Isolated from Express/fs so they can be unit-tested without a running server.
 */

/**
 * Cache-Control for a file served from dist/public.
 *
 * - Fingerprinted assets under `assets/` (names carry a content hash) never
 *   change for a given URL → cache forever, mark immutable.
 * - Everything else (notably index.html and the /app/ root) must always be
 *   revalidated → `no-store`. This is what lets a fresh deploy be picked up
 *   immediately instead of the WebView holding a stale index.html that points
 *   at an already-removed bundle.
 */
export function cacheControlForFile(filePath: string): string {
  if (/[\\/]assets[\\/]/.test(filePath)) {
    return "public, max-age=31536000, immutable";
  }
  return "no-store";
}

/**
 * Whether a request under /app that has no matching real file should fall back
 * to index.html (SPA routing, HTTP 200) or be answered with an honest 404.
 *
 * Never fall back for:
 *   - requests under `assets/` — a missing fingerprinted bundle MUST 404, never
 *     be answered with index.html (the WebView would then execute HTML as JS
 *     and die until Telegram's cache is fully reset);
 *   - any path whose last segment looks like a file (contains a dot / has an
 *     extension), e.g. favicon.ico, robots.txt.
 *
 * `pathname` may be given with or without the /app prefix.
 */
export function shouldFallbackToIndex(pathname: string): boolean {
  if (/(?:^|\/)assets\//.test(pathname)) return false;
  const lastSegment = pathname.split("/").pop() ?? "";
  if (lastSegment.includes(".")) return false;
  return true;
}
