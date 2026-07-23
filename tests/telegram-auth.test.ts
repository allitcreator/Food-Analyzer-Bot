/**
 * Pure unit tests for Telegram WebApp initData validation (no DB, no env).
 *
 * Valid initData is generated in-test with the same HMAC algorithm the server
 * uses, against a throwaway bot token. Tests the real `validateInitData`
 * exported from server/lib/telegram-auth.ts.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { validateInitData } from "../server/lib/telegram-auth";

const TEST_TOKEN = "123456:TEST-bot-token-abcdef";

type BuildOpts = {
  user?: unknown;
  authDate?: number; // unix seconds
  extra?: Record<string, string>;
  omitUser?: boolean;
};

/** Build a signed initData querystring, mirroring the official algorithm. */
function buildInitData(botToken: string, opts: BuildOpts = {}): string {
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

describe("validateInitData", () => {
  test("accepts freshly-signed initData and returns the user", () => {
    const initData = buildInitData(TEST_TOKEN, {
      user: { id: 777, first_name: "Ann", username: "ann", is_premium: true },
    });
    const r = validateInitData(initData, TEST_TOKEN);
    assert.ok(r.ok, `expected ok, got: ${JSON.stringify(r)}`);
    if (!r.ok) return;
    assert.equal(r.user.id, 777);
    assert.equal(r.user.username, "ann");
    assert.equal(r.user.is_premium, true);
  });

  test("rejects a tampered hash → invalid_hash", () => {
    const initData = buildInitData(TEST_TOKEN);
    const broken = initData.replace(/hash=[0-9a-f]+/, "hash=" + "0".repeat(64));
    const r = validateInitData(broken, TEST_TOKEN);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error, "invalid_hash");
  });

  test("rejects a wrong bot token → invalid_hash", () => {
    const initData = buildInitData(TEST_TOKEN);
    const r = validateInitData(initData, "999999:OTHER-token");
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error, "invalid_hash");
  });

  test("rejects a stale auth_date → expired", () => {
    const old = Math.floor(Date.now() / 1000) - 90_000; // > 86400s ago
    const initData = buildInitData(TEST_TOKEN, { authDate: old });
    const r = validateInitData(initData, TEST_TOKEN, 86400);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error, "expired");
  });

  test("accepts a stale auth_date when maxAge is large enough", () => {
    const old = Math.floor(Date.now() / 1000) - 90_000;
    const initData = buildInitData(TEST_TOKEN, { authDate: old });
    const r = validateInitData(initData, TEST_TOKEN, 100_000);
    assert.ok(r.ok);
  });

  test("rejects missing hash → missing_hash", () => {
    // Build valid data, then drop the hash param entirely.
    const initData = buildInitData(TEST_TOKEN);
    const params = new URLSearchParams(initData);
    params.delete("hash");
    const r = validateInitData(params.toString(), TEST_TOKEN);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error, "missing_hash");
  });

  test("rejects missing user (but otherwise well-signed) → invalid_user", () => {
    const initData = buildInitData(TEST_TOKEN, { omitUser: true });
    const r = validateInitData(initData, TEST_TOKEN);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error, "invalid_user");
  });

  test("rejects a user payload without a numeric id → invalid_user", () => {
    const initData = buildInitData(TEST_TOKEN, { user: { username: "noid" } });
    const r = validateInitData(initData, TEST_TOKEN);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error, "invalid_user");
  });
});
