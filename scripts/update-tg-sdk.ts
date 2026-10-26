/**
 * Обновить снапшот Telegram WebApp SDK: client/public/telegram-web-app.js.
 *
 *   npm run update:tg-sdk
 *
 * Скрипт хостим сами: блокирующий <script> с telegram.org вешает Mini App до
 * таймаута у пользователей, чья сеть туда не пускает. Сборка файл не трогает,
 * поэтому обновляем его вручную этим скриптом и коммитим отдельно.
 */
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";

const TELEGRAM_WEB_APP_URL = "https://telegram.org/js/telegram-web-app.js";
const TELEGRAM_WEB_APP_SNAPSHOT = "client/public/telegram-web-app.js";

async function main() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let body: string;
  try {
    const res = await fetch(TELEGRAM_WEB_APP_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.text();
  } finally {
    clearTimeout(timeout);
  }
  if (!body.trim()) throw new Error("empty body");

  const previous = await readFile(TELEGRAM_WEB_APP_SNAPSHOT, "utf-8").catch(
    () => null,
  );
  if (previous === body) {
    console.log(`${TELEGRAM_WEB_APP_SNAPSHOT}: без изменений (${body.length} байт)`);
    return;
  }

  await mkdir(dirname(TELEGRAM_WEB_APP_SNAPSHOT), { recursive: true });
  await writeFile(TELEGRAM_WEB_APP_SNAPSHOT, body);
  console.log(`${TELEGRAM_WEB_APP_SNAPSHOT}: обновлён (${body.length} байт)`);
  console.log(
    [
      "Дальше:",
      `  1. git diff ${TELEGRAM_WEB_APP_SNAPSHOT} — посмотреть, что поменялось.`,
      "  2. Проверить CSP (server/lib/security-headers.ts): сейчас в SDK нет",
      "     inline-скриптов и обращений к новым доменам; если появились —",
      "     поправить CSP, иначе Mini App сломается.",
      "  3. Открыть Mini App из бота и проверить, что всё работает.",
      "  4. Закоммитить файл отдельным коммитом.",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error(
    `не удалось обновить telegram-web-app.js: ${
      err instanceof Error ? err.message : String(err)
    }`,
  );
  process.exit(1);
});
