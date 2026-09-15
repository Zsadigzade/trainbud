import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shapeForWatch, type WatchSummary } from "../src/watchApi.js";

// The Forerunner 55 widget has 64 KB, and 2.0.4 used 51.5 KB of it before the
// cached summary was even read -- 9.8 KB left to deserialise it. A summary is
// held in memory at several times its JSON size, so every field the server adds
// is paid for on that watch whether it draws the field or not. The rule a
// finding fired on is about 120 characters, the sleep movers two more lines, and
// together they were enough to run the widget out of memory in the simulator.
//
// So a field goes only to a build that draws it: `why` and `sleep.moved` from
// 2.1.0, and not at all to a watch that says it is short on memory.

function summary(): WatchSummary {
  return {
    daily_overview: { recovery: 62, sleep_h: 6.3, stress: 31, vo2max: 46 },
    recovery: null,
    sleep: { hours: 6.3, score: 66, label: "Good", moved: ["Deep 40m (1h24m)", "Stress 33 (20)"] },
    activity: null,
    stress: null,
    vo2max: null,
    heart_rate: null,
    findings: [
      { kind: "load_ratio_high", severity: "warn", headline: "Load is 2.31x", short: "Load 2.3x avg", why: "Your 7-day TRIMP of 400 was over 1.5x your 28-day weekly average of 173." },
    ],
    coverage: { days: 99, ready: true, throughDate: "2026-09-15", staleDays: 0 },
    week: null,
    race: null,
    prompts: [],
    ai_configured: true,
    states: { recovery: "caution", sleep: "hard", stress: "caution", resting_hr: "good" },
    display: { name: null, units: "metric", cards: ["today"] },
    alert: { level: "warn", count: 1 },
    budget: { exceeded: false, incomplete: false },
    updated_at: "2026-09-15T07:13:12.642Z",
    ai_insight: null,
  } as WatchSummary;
}

function findingKeys(shaped: WatchSummary): string[] {
  return Object.keys(shaped.findings[0] ?? {}).sort();
}

describe("the watch payload is shaped for the build asking", () => {
  it("gives a 2.1.0 watch the rule and the sleep movers", () => {
    const shaped = shapeForWatch(summary(), { build: "2.1.0", lite: false });
    assert.ok(findingKeys(shaped).includes("why"));
    assert.deepEqual(shaped.sleep?.moved, ["Deep 40m (1h24m)", "Stress 33 (20)"]);
  });

  it("leaves both off for 2.0.4, which draws neither", () => {
    const shaped = shapeForWatch(summary(), { build: "2.0.4", lite: false });
    assert.ok(!findingKeys(shaped).includes("why"));
    assert.equal(shaped.sleep?.moved, undefined);
    assert.equal(shaped.findings[0]?.short, "Load 2.3x avg", "2.0.4 draws the short line");
  });

  it("leaves both off for a watch that says it is short on memory", () => {
    const shaped = shapeForWatch(summary(), { build: "2.1.0", lite: true });
    assert.ok(!findingKeys(shaped).includes("why"));
    assert.equal(shaped.sleep?.moved, undefined);
  });

  it("treats a missing or unreadable build as an old one", () => {
    for (const build of [null, "", "dev", "2"]) {
      const shaped = shapeForWatch(summary(), { build, lite: false });
      assert.ok(!findingKeys(shaped).includes("why"), `build ${String(build)}`);
    }
  });

  it("compares versions numerically, not as strings", () => {
    assert.ok(findingKeys(shapeForWatch(summary(), { build: "2.10.0", lite: false })).includes("why"));
    assert.ok(findingKeys(shapeForWatch(summary(), { build: "3.0.0", lite: false })).includes("why"));
  });

  it("does not touch the cached summary it was given", () => {
    const original = summary();
    shapeForWatch(original, { build: "2.0.4", lite: true });
    assert.ok(findingKeys(original).includes("why"));
    assert.ok(original.sleep?.moved);
  });
});
