import { describe, it, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WatchSummaryParts } from "../src/watchApi.js";
import type { Finding } from "../src/detect/findings.js";

// Writes to the profile, so it needs its own database. See profile.test.ts for
// why the redirect is at module scope.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-watch-personal-"));
process.env.TRAINBUD_CACHE_PATH = path.join(dir, "cache.db");

let watchApi: typeof import("../src/watchApi.js");
let profile: typeof import("../src/profile.js");
let appDb: typeof import("../src/appDb.js");

const EMPTY_PARTS: WatchSummaryParts = {
  recovery: null,
  sleep: null,
  activity: null,
  stress: null,
  vo2max: null,
  heartRate: null,
  findings: [],
  coverage: { days: 0, ready: false, throughDate: null, staleDays: 0 },
  context: [],
  week: null,
  race: null,
  restingHrDeltaBpm: null,
  aiConfigured: false,
  updatedAt: "2026-09-04T00:00:00.000Z",
};

function recoveryParts(score: number): WatchSummaryParts {
  return {
    ...EMPTY_PARTS,
    recovery: {
      recovery: { score, status: score >= 70 ? "recovered" : "fatigued" },
    } as unknown as WatchSummaryParts["recovery"],
  };
}

function finding(severity: Finding["severity"]): Finding {
  return {
    kind: "rhr_elevated",
    severity,
    date: "2026-09-03",
    headline: "headline",
    detail: "detail",
    values: {},
  };
}

beforeEach(async () => {
  watchApi = await import("../src/watchApi.js");
  profile = await import("../src/profile.js");
  appDb = await import("../src/appDb.js");
  appDb.deleteSetting("profile");
  profile.__resetProfileCacheForTests();
});

afterEach(() => {
  appDb.closeAppDb();
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.TRAINBUD_CACHE_PATH;
});

describe("the watch is told what a number means, not where the line is", () => {
  it("grades recovery on the payload", () => {
    assert.equal(watchApi.buildWatchSummaryFrom(recoveryParts(91)).states.recovery, "good");
    assert.equal(watchApi.buildWatchSummaryFrom(recoveryParts(55)).states.recovery, "caution");
    assert.equal(watchApi.buildWatchSummaryFrom(recoveryParts(20)).states.recovery, "hard");
  });

  it("moves the grade when the user moves their own band", () => {
    // This is the whole reason the grading is here rather than in Monkey C.
    // The watch cannot see this setting and never has to.
    profile.updateProfile({ thresholds: { recovery: { good: 95, caution: 90 } } });
    assert.equal(watchApi.buildWatchSummaryFrom(recoveryParts(91)).states.recovery, "caution");
  });

  it("reports unknown for a metric that was never measured", () => {
    // Not "hard". An unworn watch is not a recovery score of zero, and a red
    // ring drawn over an absence is a measurement the app invented.
    const states = watchApi.buildWatchSummaryFrom(EMPTY_PARTS).states;
    assert.equal(states.recovery, "unknown");
    assert.equal(states.sleep, "unknown");
    assert.equal(states.stress, "unknown");
    assert.equal(states.resting_hr, "unknown");
  });

  it("grades resting heart rate on the distance from this person's own median", () => {
    // 58 bpm is unremarkable for one person and a warning for another, so the
    // rate itself is never graded -- only the delta.
    const near = watchApi.buildWatchSummaryFrom({ ...EMPTY_PARTS, restingHrDeltaBpm: 1 });
    const far = watchApi.buildWatchSummaryFrom({ ...EMPTY_PARTS, restingHrDeltaBpm: 9 });
    assert.equal(near.states.resting_hr, "good");
    assert.equal(far.states.resting_hr, "hard");
  });
});

describe("the carousel the watch draws", () => {
  it("ships the full card list in the user's order", () => {
    const display = watchApi.buildWatchSummaryFrom(EMPTY_PARTS).display;
    assert.deepEqual(display.cards, [...profile.CARD_IDS]);
    assert.equal(display.units, "metric");
    assert.equal(display.name, null);
  });

  it("drops a hidden card and keeps the reordering", () => {
    profile.updateProfile({ cards: { order: ["week", "today"], hidden: ["stress"] } });
    const cards = watchApi.buildWatchSummaryFrom(EMPTY_PARTS).display.cards;
    assert.deepEqual(cards.slice(0, 2), ["week", "today"]);
    assert.ok(!cards.includes("stress"));
  });

  it("carries the name and units the user set", () => {
    profile.updateProfile({ displayName: "Ziya", units: "imperial" });
    const display = watchApi.buildWatchSummaryFrom(EMPTY_PARTS).display;
    assert.equal(display.name, "Ziya");
    assert.equal(display.units, "imperial");
  });
});

describe("the alert badge", () => {
  it("is none when nothing stands out", () => {
    assert.deepEqual(watchApi.buildWatchSummaryFrom(EMPTY_PARTS).alert, {
      level: "none",
      count: 0,
    });
  });

  it("takes the worst severity present", () => {
    const summary = watchApi.buildWatchSummaryFrom({
      ...EMPTY_PARTS,
      findings: [finding("notice"), finding("warn")],
    });
    assert.equal(summary.alert.level, "warn");
    assert.equal(summary.alert.count, 2);
  });

  it("does not raise the badge for an informational finding", () => {
    // A line on the Today card, not a dot on a watch face.
    const summary = watchApi.buildWatchSummaryFrom({
      ...EMPTY_PARTS,
      findings: [finding("info")],
    });
    assert.equal(summary.alert.level, "none");
    assert.equal(summary.alert.count, 1);
  });
});

describe("the budget the watch is warned about", () => {
  it("is not exceeded when the user set no cap", () => {
    assert.deepEqual(watchApi.buildWatchSummaryFrom(EMPTY_PARTS).budget, {
      exceeded: false,
      incomplete: false,
    });
  });
});
