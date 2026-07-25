import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import {
  cacheControlForFile,
  shouldFallbackToIndex,
} from "./lib/static-headers";

/**
 * Serve the built Mini App (dist/public) under `/app` with an SPA fallback,
 * matching the Vite `base: "/app/"` configuration. `/` redirects to `/app/`.
 *
 * Caching is tuned for the Telegram WebView:
 *   - index.html / root → `no-store` (always fresh, picks up new deploys);
 *   - fingerprinted /app/assets/* → `immutable`, cached for a year;
 *   - a missing asset returns an honest 404, never index.html.
 */
export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const indexHtml = path.resolve(distPath, "index.html");

  // Root → Mini App.
  app.get("/", (_req, res) => res.redirect("/app/"));

  // Static assets: /app/assets/*, /app/index.html, etc.
  // `index: false` — we serve "/app/" via the fallback below so it also gets
  // the `no-store` header instead of express.static's default `max-age=0`.
  app.use(
    "/app",
    express.static(distPath, {
      index: false,
      setHeaders: (res, filePath) => {
        res.setHeader("Cache-Control", cacheControlForFile(filePath));
      },
    }),
  );

  // SPA fallback: only for real app routes. Missing assets / file-like paths
  // fall through to a 404 rather than being answered with index.html.
  app.use("/app/{*path}", (req, res, next) => {
    if (!shouldFallbackToIndex(req.path)) {
      return next();
    }
    res.sendFile(indexHtml, {
      cacheControl: false,
      etag: false,
      lastModified: false,
      headers: { "Cache-Control": "no-store" },
    });
  });
}
