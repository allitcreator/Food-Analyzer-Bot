import express, { type Express } from "express";
import fs from "fs";
import path from "path";

/**
 * Serve the built Mini App (dist/public) under `/app` with an SPA fallback,
 * matching the Vite `base: "/app/"` configuration. `/` redirects to `/app/`.
 */
export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Root → Mini App.
  app.get("/", (_req, res) => res.redirect("/app/"));

  // Static assets: /app/assets/*, /app/index.html, etc.
  app.use("/app", express.static(distPath));

  // SPA fallback: any /app/* route that isn't a real file → index.html.
  app.use("/app/{*path}", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
