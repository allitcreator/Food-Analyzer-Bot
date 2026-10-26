/**
 * /api/health: проверка базы через `SELECT 1` с коротким таймаутом.
 * Хендлер собирается из функции-пинга, поэтому тест обходится без Postgres:
 * подставляем пинг, который отвечает, падает или висит.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { createHealthHandler } from "../server/lib/health";

async function call(ping: () => Promise<unknown>, timeoutMs = 200) {
  const app = express();
  app.get("/api/health", createHealthHandler(ping, timeoutMs));
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const { port } = server.address() as AddressInfo;
    const started = Date.now();
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const elapsed = Date.now() - started;
    const body = await res.text();
    return { res, body, elapsed };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("createHealthHandler", () => {
  test("база отвечает → 200 и status ok", async () => {
    const { res, body } = await call(async () => undefined);
    assert.equal(res.status, 200);
    const json = JSON.parse(body);
    assert.equal(json.status, "ok");
    assert.equal(typeof json.timestamp, "number");
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  test("база упала → 503 без текста ошибки", async () => {
    const secret = "password authentication failed for user bot at 10.0.0.5";
    const origError = console.error;
    console.error = () => {};
    try {
      const { res, body } = await call(async () => {
        throw new Error(secret);
      });
      assert.equal(res.status, 503);
      assert.equal(JSON.parse(body).status, "error");
      assert.ok(!body.includes("password"), "текст ошибки не должен уходить наружу");
      assert.ok(!body.includes("10.0.0.5"));
    } finally {
      console.error = origError;
    }
  });

  test("база висит → 503 по таймауту, не ждём бесконечно", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const { res, body, elapsed } = await call(
        () => new Promise(() => {}),
        150,
      );
      assert.equal(res.status, 503);
      assert.equal(JSON.parse(body).status, "error");
      assert.ok(elapsed < 2000, `ответ должен прийти по таймауту, а шёл ${elapsed} мс`);
    } finally {
      console.error = origError;
    }
  });
});
