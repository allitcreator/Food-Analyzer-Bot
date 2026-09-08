/**
 * Интеграционная проверка живого сервера — НЕ входит в `npm test`.
 *
 * Требует уже запущенного приложения: `npm run dev`, затем `npm run test:api`.
 * Без него тест падает, и падает обманчиво: на macOS порт 5000 занят
 * системным AirPlay-приёмником, который отвечает 403, а не отказом в
 * соединении.
 *
 * Порт при необходимости переопределяется: `API_BASE=http://localhost:8082 npm run test:api`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.API_BASE ?? "http://localhost:5000";

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, opts);
  return res;
}

describe("GET /api/health", () => {
  test("returns ok status", async () => {
    const res = await api("/api/health");
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.status, "ok");
    assert.ok(typeof body.timestamp === "number", "timestamp should be a number");
  });
});
