/**
 * Tests for Mini App static serving:
 *  - unit tests for the pure header/fallback helpers;
 *  - integration tests for the actual Express wiring (serveStatic), because
 *    Express 5 puts the whole matched path of `app.use("/app/{*path}")` into
 *    req.baseUrl and leaves req.path as "/" — a wiring bug the unit tests of
 *    the pure function alone cannot catch.
 * No DB needed.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  cacheControlForFile,
  shouldFallbackToIndex,
} from "../server/lib/static-headers";
import { serveStatic } from "../server/static";

describe("cacheControlForFile", () => {
  test("fingerprinted assets → immutable, one-year max-age", () => {
    assert.equal(
      cacheControlForFile("/srv/dist/public/assets/index-abc123.js"),
      "public, max-age=31536000, immutable",
    );
    assert.equal(
      cacheControlForFile("/srv/dist/public/assets/index-def456.css"),
      "public, max-age=31536000, immutable",
    );
  });

  test("index.html is never cached", () => {
    assert.equal(
      cacheControlForFile("/srv/dist/public/index.html"),
      "no-store",
    );
  });

  test("other root files are not cached", () => {
    assert.equal(
      cacheControlForFile("/srv/dist/public/favicon.ico"),
      "no-store",
    );
    assert.equal(
      cacheControlForFile("/srv/dist/public/manifest.json"),
      "no-store",
    );
  });
});

describe("shouldFallbackToIndex", () => {
  test("app routes → serve index.html (SPA)", () => {
    assert.equal(shouldFallbackToIndex("/app/"), true);
    assert.equal(shouldFallbackToIndex("/app/profile"), true);
    assert.equal(shouldFallbackToIndex("/app/history/2024"), true);
  });

  test("missing asset → honest 404, never index.html", () => {
    assert.equal(shouldFallbackToIndex("/app/assets/index-old.js"), false);
    assert.equal(shouldFallbackToIndex("/app/assets/index-old.css"), false);
    // Also robust without the /app prefix (mount-relative paths).
    assert.equal(shouldFallbackToIndex("/assets/index-old.js"), false);
    assert.equal(shouldFallbackToIndex("assets/index-old.js"), false);
  });

  test("file-like paths (with extension) → no fallback", () => {
    assert.equal(shouldFallbackToIndex("/app/favicon.ico"), false);
    assert.equal(shouldFallbackToIndex("/app/robots.txt"), false);
    assert.equal(shouldFallbackToIndex("/app/sw.js"), false);
  });
});

// ─── Integration: real Express app with serveStatic ─────────────────────────
// Spins up serveStatic() on an ephemeral port against a temp dist dir.
// This is what catches wiring bugs (Express 5 req.path vs originalUrl).
describe("serveStatic wiring (integration)", () => {
  let dist: string;
  let server: Server;
  let base: string;

  before(async () => {
    dist = mkdtempSync(path.join(tmpdir(), "static-test-"));
    writeFileSync(
      path.join(dist, "index.html"),
      "<!DOCTYPE html><html><body>MINIAPP</body></html>",
    );
    mkdirSync(path.join(dist, "assets"));
    writeFileSync(
      path.join(dist, "assets", "index-realhash.js"),
      "console.log('real bundle')",
    );

    const app = express();
    serveStatic(app, dist);
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dist, { recursive: true, force: true });
  });

  test("missing asset (stale bundle after deploy) → 404, not index.html", async () => {
    const res = await fetch(`${base}/app/assets/index-7wh-jvBb.js`);
    assert.equal(res.status, 404);
    const body = await res.text();
    assert.ok(!body.includes("MINIAPP"), "must not serve index.html for a missing asset");
  });

  test("existing asset → 200, immutable one-year cache", async () => {
    const res = await fetch(`${base}/app/assets/index-realhash.js`);
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
    );
  });

  test("/app/ → 200 html with no-store", async () => {
    const res = await fetch(`${base}/app/`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.ok((await res.text()).includes("MINIAPP"));
  });

  test("SPA route /app/history → 200 html with no-store", async () => {
    const res = await fetch(`${base}/app/history`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.ok((await res.text()).includes("MINIAPP"));
  });

  test("SPA route with query string still falls back", async () => {
    const res = await fetch(`${base}/app/history/2024?tab=week`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  test("explicit /app/index.html → 200 with no-store", async () => {
    const res = await fetch(`${base}/app/index.html`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  test("file-like path without a real file → 404", async () => {
    const res = await fetch(`${base}/app/robots.txt`);
    assert.equal(res.status, 404);
  });

  test("root / redirects to /app/", async () => {
    const res = await fetch(`${base}/`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/app/");
  });
});
