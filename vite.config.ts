import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  // Mini App is served under https://<host>/app/ in production.
  base: "/app/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Vite 7 defaults to "baseline-widely-available" (Chrome 107+/Safari 16+),
    // which can throw a SyntaxError while *parsing* the bundle on older
    // Telegram WebViews → blank screen. es2018 makes esbuild transpile newer
    // syntax (optional chaining, class fields, ...) down to broadly-supported JS.
    target: "es2018",
    // Lower modern CSS (e.g. `hsl(h s l / a)` color syntax) for old WebViews.
    cssTarget: ["chrome61", "safari12"],
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
