/**
 * Telegram WebApp `initData` validation + Express auth middleware.
 *
 * `validateInitData` is a pure, env-free function (only `node:crypto`) so it
 * can be unit-tested without a bot token or database. The middleware wires it
 * into Express: it maps the Telegram user to a DB user and enforces access.
 *
 * Reference: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
import crypto from "node:crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { User } from "@shared/schema";

// `storage` and `config` are imported lazily inside the middleware so this
// module (and `validateInitData` in particular) can be unit-tested without a
// database connection or environment variables — importing `../config` at load
// time would throw on missing env vars.

export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
};

export type ValidateInitDataResult =
  | { ok: true; user: TelegramUser; authDate: number }
  | { ok: false; error: string };

/**
 * Validate a Telegram WebApp `initData` querystring against the bot token.
 *
 * Steps (per official docs):
 *  1. parse the querystring, pull out `hash`;
 *  2. build data_check_string from the remaining pairs, sorted by key,
 *     joined as `key=value` with `\n`;
 *  3. secretKey = HMAC_SHA256(key="WebAppData", data=botToken);
 *  4. expectedHash = hex(HMAC_SHA256(key=secretKey, data=dataCheckString));
 *  5. compare with `timingSafeEqual`; then check `auth_date` freshness.
 *
 * Distinct errors: "missing_hash", "invalid_hash", "expired", "invalid_user".
 */
export function validateInitData(
  initDataRaw: string,
  botToken: string,
  maxAgeSec = 86400,
): ValidateInitDataResult {
  const params = new URLSearchParams(initDataRaw);

  const hash = params.get("hash");
  if (!hash) {
    return { ok: false, error: "missing_hash" };
  }

  // Collect all pairs except `hash` (forEach avoids for-of iterator downleveling).
  const pairs: string[] = [];
  params.forEach((value, key) => {
    if (key === "hash") return;
    pairs.push(`${key}=${value}`);
  });
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const expectedBuf = Buffer.from(expectedHash, "hex");
  const providedBuf = Buffer.from(hash, "hex");
  if (
    expectedBuf.length === 0 ||
    expectedBuf.length !== providedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, providedBuf)
  ) {
    return { ok: false, error: "invalid_hash" };
  }

  // Freshness: auth_date is a unix timestamp (seconds).
  const authDateRaw = params.get("auth_date");
  const authDate = authDateRaw ? Number(authDateRaw) : NaN;
  if (!Number.isFinite(authDate)) {
    return { ok: false, error: "expired" };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - authDate > maxAgeSec) {
    return { ok: false, error: "expired" };
  }

  // User payload.
  const userRaw = params.get("user");
  if (!userRaw) {
    return { ok: false, error: "invalid_user" };
  }
  let user: TelegramUser;
  try {
    const parsed = JSON.parse(userRaw);
    if (!parsed || typeof parsed.id !== "number") {
      return { ok: false, error: "invalid_user" };
    }
    user = parsed as TelegramUser;
  } catch {
    return { ok: false, error: "invalid_user" };
  }

  return { ok: true, user, authDate };
}

// Augment Express Request with the authenticated DB user.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      appUser?: User;
    }
  }
}

/**
 * Extract the raw initData from an `Authorization: tma <initData>` header.
 */
function extractInitData(req: Request): string | null {
  const header = req.headers["authorization"];
  if (!header || typeof header !== "string") return null;
  const match = /^tma\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * Express middleware: validate initData, load the DB user by Telegram id,
 * enforce access, and attach the user to `req.appUser`.
 *
 * - 401 — missing/invalid initData;
 * - 403 — user not found, blocked, or not approved (unless admin).
 */
export const telegramAuth: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const initData = extractInitData(req);
  if (!initData) {
    res.status(401).json({ error: "unauthorized", reason: "missing_init_data" });
    return;
  }

  const { config } = await import("../config");
  const { storage } = await import("../storage");

  const result = validateInitData(initData, config.telegramBotToken);
  if (!result.ok) {
    res.status(401).json({ error: "unauthorized", reason: result.error });
    return;
  }

  let user: User | undefined;
  try {
    user = await storage.getUserByTelegramId(String(result.user.id));
  } catch (err) {
    next(err);
    return;
  }

  if (!user) {
    res.status(403).json({ error: "forbidden", reason: "not_registered" });
    return;
  }
  if (user.isBlocked) {
    res.status(403).json({ error: "forbidden", reason: "blocked" });
    return;
  }
  if (!user.isApproved && !user.isAdmin) {
    res.status(403).json({ error: "forbidden", reason: "not_approved" });
    return;
  }

  req.appUser = user;
  next();
};
