import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-partial-"));
process.env.TRAINBUD_CACHE_PATH = path.join(tempDir, "cache.db");

const { PARTIAL_CACHE_TTL_SECONDS, closeCache, getCache, withCache } = await import(
  "../src/garmin/cache.js"
);
const { fetchEachDay, isPartial, partialFetchNote } = await import("../src/garmin/partial.js");
const { buildSleepPayload, renderSleepText } = await import("../src/tools/sleep.js");

describe("a failed request must not be cached as an answer", () => {
  before(() => {
    getCache().clear();
  });

  after(() => {
    closeCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("keeps a complete result for its full ttl", async () => {
    const key = "complete";
    await withCache(key, 3600, async () => ({ values: [1], unreachableDays: 0, requestedDays: 1 }), {
      isPartial,
    });

    const row = getCache().stats();
    assert.equal(row.expiredEntries, 0);
    assert.equal(
      ttlOf(key),
      3600,
      "a fetch that reached Garmin for every day earns the configured ttl"
    );
  });

  it("keeps a result that is missing days because requests failed for only a minute", async () => {
    const key = "partial";
    await withCache(
      key,
      7200,
      async () => ({ values: [], unreachableDays: 7, requestedDays: 7 }),
      { isPartial }
    );

    assert.equal(
      ttlOf(key),
      PARTIAL_CACHE_TTL_SECONDS,
      "an outage must not freeze 'no data' in for the success ttl"
    );
  });

  it("caches nothing at all when the fetcher throws", async () => {
    await assert.rejects(
      withCache("thrown", 3600, async () => {
        throw new Error("Cloudflare 1015");
      })
    );

    assert.equal(getCache().get("thrown"), null);
  });

  it("counts the days it could not fetch instead of discarding them", async () => {
    const result = await fetchEachDay(
      ["a", "b", "c"],
      async (date) => {
        if (date === "b") throw new Error("429");
        if (date === "c") return null;
        return date;
      },
      "test"
    );

    assert.deepEqual(result.values, ["a"]);
    assert.equal(result.unreachableDays, 1, "'b' failed");
    assert.equal(result.requestedDays, 3);
    assert.ok(isPartial(result));
  });

  it("a day with no measurement is not a day that could not be fetched", async () => {
    const result = await fetchEachDay(["a", "b"], async () => null, "test");

    assert.deepEqual(result.values, []);
    assert.equal(result.unreachableDays, 0);
    assert.equal(isPartial(result), false);
    assert.equal(partialFetchNote(result, "days"), "");
  });

  it("says nothing was recorded and could not reach Garmin in different words", () => {
    const nothingRecorded = renderSleepText(buildSleepPayload([], 7, 0));
    const couldNotReach = renderSleepText(buildSleepPayload([], 7, 7));

    assert.match(nothingRecorded, /No sleep data found/);
    assert.match(couldNotReach, /Could not reach Garmin/);
    assert.notEqual(
      nothingRecorded,
      couldNotReach,
      "nothing found and nothing known must not render the same"
    );
  });
});

function ttlOf(key: string): number {
  const cache = getCache() as unknown as {
    db: { prepare(sql: string): { get(k: string): { ttl: number } | undefined } };
  };
  const row = cache.db.prepare("SELECT ttl FROM cache WHERE key = ?").get(key);
  assert.ok(row, `expected ${key} to be cached`);
  return row.ttl;
}
