import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { GarminCache } from "../src/garmin/cache.js";

describe("GarminCache", () => {
  let cache: GarminCache;
  let tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-cache-"));

  afterEach(() => {
    cache.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-cache-"));
  });

  it("returns null on cache miss", () => {
    const dbPath = path.join(tempDir, "cache.db");
    cache = new GarminCache(dbPath);
    assert.equal(cache.get("missing:key"), null);
  });

  it("stores and retrieves cached values before ttl expiry", () => {
    const dbPath = path.join(tempDir, "cache.db");
    cache = new GarminCache(dbPath);
    cache.set("tool:params", { value: 42 }, 3600);

    const result = cache.get<{ value: number }>("tool:params");
    assert.deepEqual(result, { value: 42 });
  });

  it("buildKey produces stable hashes regardless of param key order", () => {
    const dbPath = path.join(tempDir, "cache.db");
    cache = new GarminCache(dbPath);

    const first = cache.buildKey("tool", { b: 2, a: 1 });
    const second = cache.buildKey("tool", { a: 1, b: 2 });
    assert.equal(first, second);
  });

  it("expires entries after ttl", () => {
    const dbPath = path.join(tempDir, "cache.db");
    cache = new GarminCache(dbPath);
    cache.set("tool:expired", { value: 1 }, 0);

    assert.equal(cache.get("tool:expired"), null);
  });

  it("clears all cache entries", () => {
    const dbPath = path.join(tempDir, "cache.db");
    cache = new GarminCache(dbPath);
    cache.set("tool:a", { value: 1 }, 3600);
    cache.set("tool:b", { value: 2 }, 3600);

    const removed = cache.clear();
    assert.equal(removed, 2);
    assert.equal(cache.get("tool:a"), null);
  });
});
