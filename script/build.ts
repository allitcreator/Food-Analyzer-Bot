import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";

// Официальный URL Telegram WebApp bridge и путь к локальному снапшоту, который
// Vite копирует из client/public/ в корень dist/public/ (см. client/index.html).
const TELEGRAM_WEB_APP_URL = "https://telegram.org/js/telegram-web-app.js";
const TELEGRAM_WEB_APP_SNAPSHOT = "client/public/telegram-web-app.js";

/**
 * Обновить локальный снапшот telegram-web-app.js перед сборкой.
 *
 * Мы сами хостим этот скрипт (иначе блокирующий <script> с telegram.org вешает
 * страницу до таймаута у пользователей, чья сеть туда не пускает). Снапшот надо
 * держать свежим — тянем актуальную версию с telegram.org на сборочной машине
 * (у неё доступ к telegram.org есть, в отличие от сети конечного пользователя).
 *
 * Сборка НЕ должна падать из-за сети: при любой ошибке или пустом теле —
 * предупреждаем и продолжаем со старым снапшотом из репозитория.
 */
async function updateTelegramSnapshot() {
  console.log("refreshing telegram-web-app.js snapshot...");
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let body: string;
    try {
      const res = await fetch(TELEGRAM_WEB_APP_URL, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = await res.text();
    } finally {
      clearTimeout(timeout);
    }
    if (!body.trim()) throw new Error("empty body");
    await mkdir(dirname(TELEGRAM_WEB_APP_SNAPSHOT), { recursive: true });
    await writeFile(TELEGRAM_WEB_APP_SNAPSHOT, body);
    console.log(`  updated (${body.length} bytes)`);
  } catch (err) {
    console.warn(
      `  warn: could not refresh telegram-web-app.js (${
        err instanceof Error ? err.message : String(err)
      }); keeping existing snapshot`,
    );
  }
}

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "openai",
  "p-retry",
  "pg",
  "ws",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  await updateTelegramSnapshot();

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
