/**
 * Подпись Telegram WebApp initData для тестов — тем же HMAC-алгоритмом, что
 * проверяет сервер (server/lib/telegram-auth.ts), но независимой реализацией.
 */
import crypto from "node:crypto";

export const TEST_TOKEN = "123456:TEST-bot-token-abcdef";

export type BuildOpts = {
  user?: unknown;
  authDate?: number; // unix seconds
  extra?: Record<string, string>;
  omitUser?: boolean;
};

/** Build a signed initData querystring, mirroring the official algorithm. */
export function buildInitData(botToken: string, opts: BuildOpts = {}): string {
  const authDate = opts.authDate ?? Math.floor(Date.now() / 1000);
  const params = new URLSearchParams();
  params.set("auth_date", String(authDate));
  params.set("query_id", "AAHdF6IQAAAAAN0XohDhrOrc");
  if (!opts.omitUser) {
    const user = opts.user ?? { id: 42, first_name: "Test", username: "tester" };
    params.set("user", JSON.stringify(user));
  }
  if (opts.extra) {
    for (const k of Object.keys(opts.extra)) params.set(k, opts.extra[k]);
  }

  // data_check_string: sorted "key=value" (decoded values), joined by "\n".
  const pairs: string[] = [];
  params.forEach((value, key) => {
    pairs.push(`${key}=${value}`);
  });
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}
