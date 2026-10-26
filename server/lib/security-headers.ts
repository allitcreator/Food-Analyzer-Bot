/**
 * Заголовки безопасности для API и Mini App.
 *
 * HSTS здесь нет намеренно: его ставит nginx на хосте, дубль не нужен.
 * X-Frame-Options тоже нет: Telegram Web открывает Mini App в iframe с
 * web.telegram.org, а разрешить конкретный домен умеет только CSP
 * frame-ancestors.
 */
import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/** nosniff и Referrer-Policy — на все ответы приложения (API, статика, 404). */
export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Mini App и API ходят только на свой origin, Referer наружу не нужен.
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
}

/**
 * CSP-источники `'sha256-…'` для inline-скриптов (`<script>` без src) в HTML.
 *
 * Считаются из того index.html, который реально отдаётся (dist/public), при
 * старте сервера — поэтому правка оверлея ошибок в client/index.html не требует
 * руками обновлять хэш. HTML-комментарии вырезаются: в них упоминается
 * `<script>`, и без этого получился бы мусорный хэш.
 */
export function inlineScriptHashes(html: string): string[] {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
  const re = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  const hashes: string[] = [];
  for (const m of withoutComments.matchAll(re)) {
    const digest = createHash("sha256").update(m[1], "utf8").digest("base64");
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes;
}

/**
 * Content-Security-Policy для HTML Mini App.
 *
 * - script-src: свой origin (бандл и самохостный telegram-web-app.js) плюс
 *   хэши inline-скриптов; без 'unsafe-inline' и 'unsafe-eval'.
 * - style-src 'unsafe-inline': React `style=`, recharts и telegram-web-app.js
 *   (создаёт <style>) без него ломаются.
 * - img-src data: blob: — превью фото через URL.createObjectURL и data URL.
 * - connect-src 'self' — API только свой.
 * - frame-ancestors — Telegram Web (iframe); мобильные и десктопные клиенты
 *   открывают WebView без iframe, их это не касается.
 */
export function miniAppCsp(scriptHashes: string[]): string {
  return [
    "default-src 'self'",
    ["script-src", "'self'", ...scriptHashes].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors https://web.telegram.org https://*.telegram.org",
  ].join("; ");
}
