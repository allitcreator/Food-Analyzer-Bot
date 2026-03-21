import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:5000";

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

describe("POST /api/health/apple", () => {
  test("rejects missing token with 400", async () => {
    const res = await api("/api/health/apple", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steps: 5000 }),
    });
    assert.equal(res.status, 400);
  });

  test("rejects invalid token with 401", async () => {
    const res = await api("/api/health/apple", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "non-existent-token-12345", steps: 5000 }),
    });
    assert.equal(res.status, 401);
    const body = await res.json() as any;
    assert.equal(body.error, "Invalid token");
  });

  test("rejects non-integer steps with 400", async () => {
    const res = await api("/api/health/apple", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "test", steps: "не число" }),
    });
    assert.equal(res.status, 400);
  });

  test("rejects negative steps with 400", async () => {
    const res = await api("/api/health/apple", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "test", steps: -100 }),
    });
    assert.equal(res.status, 400);
  });

  test("accepts empty payload with only token (still 401 with fake token)", async () => {
    const res = await api("/api/health/apple", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "fake-uuid-0000-0000-0000-000000000000" }),
    });
    assert.equal(res.status, 401);
  });

  test("accepts workouts array structure", async () => {
    const res = await api("/api/health/apple", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "non-existent-token-xyz",
        steps: 8000,
        active_calories: 400,
        workouts: [{ type: "Бег", duration_min: 30, calories: 280 }],
      }),
    });
    assert.equal(res.status, 401);
  });
});

describe("GET /api/health/setup/:token", () => {
  test("returns 404 for unknown token", async () => {
    const res = await api("/api/health/setup/totally-invalid-token-xyz");
    assert.equal(res.status, 404);
  });

  test("response is text (not JSON) for 404", async () => {
    const res = await api("/api/health/setup/totally-invalid-token-xyz");
    const ct = res.headers.get("content-type") ?? "";
    assert.ok(ct.includes("text"), `Expected text content type, got: ${ct}`);
  });
});

