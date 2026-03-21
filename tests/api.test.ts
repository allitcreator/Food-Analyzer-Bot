import { test, describe } from "node:test";
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
