/**
 * Unit tests for Mini App static-serving header/fallback logic.
 * Pure functions — no running server or DB needed.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  cacheControlForFile,
  shouldFallbackToIndex,
} from "../server/lib/static-headers";

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
