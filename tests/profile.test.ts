import { describe, it, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The profile lives in app.db, whose path resolves from config at import time.
// Redirecting the cache path before a DYNAMIC import is the only thing that
// works -- a static import binds the real .trainbud/app.db and the test writes
// into the developer's own database. That mistake shipped once already, in the
// cooldown test, and blocked live Garmin requests for five minutes per run.
//
// The redirect has to happen ONCE, before the first import, and the directory
// has to outlive every test in the file. `appDb` computes DB_PATH at module
// scope, and a dynamic import of the same specifier returns the module that is
// already in the registry -- so re-pointing the env var per test moves nothing,
// and tearing the directory down per test leaves later tests reading a database
// in a directory that was deleted. Written per-test first, this file leaked a
// saved profile from one case into the next and the unit-validation test failed
// against a value the previous test had stored.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-profile-"));
process.env.TRAINBUD_CACHE_PATH = path.join(dir, "cache.db");

let profile: typeof import("../src/profile.js");
let appDb: typeof import("../src/appDb.js");

beforeEach(async () => {
  profile = await import("../src/profile.js");
  appDb = await import("../src/appDb.js");
  // One database for the file; each test starts from an empty profile row.
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

describe("profile defaults", () => {
  it("returns a complete profile before anything has been saved", () => {
    const p = profile.getProfile();
    assert.equal(p.units, "metric");
    assert.ok(p.thresholds.recovery.good > p.thresholds.recovery.caution);
    assert.ok(p.cards.order.length > 0);
    assert.equal(p.budget.monthlyUsd, null);
    assert.equal(p.analytics.enabled, true);
  });

  it("ships every known card in the default order, none hidden", () => {
    const p = profile.getProfile();
    assert.deepEqual([...p.cards.order].sort(), [...profile.CARD_IDS].sort());
    assert.deepEqual(p.cards.hidden, []);
  });
});

describe("profile update", () => {
  it("merges a partial update and leaves the rest alone", () => {
    profile.updateProfile({ displayName: "Ziya", units: "imperial" });
    const p = profile.getProfile();
    assert.equal(p.displayName, "Ziya");
    assert.equal(p.units, "imperial");
    assert.equal(
      p.thresholds.recovery.good,
      profile.DEFAULT_PROFILE.thresholds.recovery.good
    );
  });

  it("persists across a fresh read", () => {
    profile.updateProfile({ displayName: "Ziya" });
    profile.__resetProfileCacheForTests();
    assert.equal(profile.getProfile().displayName, "Ziya");
  });

  it("rejects a unit it does not know instead of storing it", () => {
    assert.throws(() => profile.updateProfile({ units: "furlongs" as never }));
    assert.equal(profile.getProfile().units, "metric");
  });

  it("rejects thresholds that cross over", () => {
    // Recovery is higher-is-better, so `good` below `caution` describes no
    // band at all -- every value would be simultaneously both.
    assert.throws(
      () => profile.updateProfile({ thresholds: { recovery: { good: 40, caution: 70 } } }),
      /recovery/i
    );
  });

  it("rejects a negative budget", () => {
    assert.throws(() => profile.updateProfile({ budget: { monthlyUsd: -1 } }));
  });

  it("accepts a null budget as 'no cap'", () => {
    profile.updateProfile({ budget: { monthlyUsd: 10 } });
    profile.updateProfile({ budget: { monthlyUsd: null } });
    assert.equal(profile.getProfile().budget.monthlyUsd, null);
  });

  it("refuses a model it cannot price", () => {
    // An unpriced model records tokens with an unknown cost, which makes the
    // monthly cap silently unenforceable. The choice is limited to what
    // usage.ts has published rates for.
    assert.throws(() => profile.updateProfile({ ai: { model: "gpt-9" as never } }));
  });
});

describe("card order", () => {
  it("rejects a card id that does not exist", () => {
    assert.throws(
      () => profile.updateProfile({ cards: { order: ["today", "nope"] } }),
      /nope/
    );
  });

  it("appends cards the client did not mention rather than dropping them", () => {
    // A watch or dashboard built against an older card set must not be able to
    // delete a card it has never heard of by omitting it from the order.
    profile.updateProfile({ cards: { order: ["week", "today"] } });
    const order = profile.getProfile().cards.order;
    assert.deepEqual(order.slice(0, 2), ["week", "today"]);
    assert.deepEqual([...order].sort(), [...profile.CARD_IDS].sort());
  });

  it("refuses to hide every card", () => {
    assert.throws(
      () => profile.updateProfile({ cards: { hidden: [...profile.CARD_IDS] } }),
      /at least one/i
    );
  });

  it("reports the visible order with hidden cards removed", () => {
    profile.updateProfile({ cards: { hidden: ["stress"] } });
    assert.ok(!profile.visibleCards().includes("stress"));
    assert.ok(profile.visibleCards().includes("today"));
  });
});

describe("corrupt profile storage", () => {
  it("falls back to defaults rather than throwing when the row is not JSON", () => {
    appDb.setSetting("profile", "{not json");
    profile.__resetProfileCacheForTests();
    assert.equal(profile.getProfile().units, "metric");
  });

  it("keeps the fields it can read when only part of the row is wrong", () => {
    appDb.setSetting("profile", JSON.stringify({ displayName: "Ziya", units: "parsecs" }));
    profile.__resetProfileCacheForTests();
    const p = profile.getProfile();
    assert.equal(p.displayName, "Ziya");
    assert.equal(p.units, "metric");
  });
});

describe("metric state", () => {
  it("grades recovery against the configured band", () => {
    assert.equal(profile.stateFor("recovery", 85), "good");
    assert.equal(profile.stateFor("recovery", 60), "caution");
    assert.equal(profile.stateFor("recovery", 30), "hard");
  });

  it("inverts direction for stress, where lower is better", () => {
    assert.equal(profile.stateFor("stress", 15), "good");
    assert.equal(profile.stateFor("stress", 40), "caution");
    assert.equal(profile.stateFor("stress", 80), "hard");
  });

  it("returns unknown for a missing value instead of grading it as zero", () => {
    // An unworn watch is not a recovery score of nothing. Rendering an absence
    // as a measurement is the mistake this project keeps making.
    assert.equal(profile.stateFor("recovery", null), "unknown");
    assert.equal(profile.stateFor("recovery", undefined), "unknown");
  });

  it("follows the user's own thresholds once they change them", () => {
    profile.updateProfile({ thresholds: { recovery: { good: 90, caution: 80 } } });
    assert.equal(profile.stateFor("recovery", 85), "caution");
  });

  it("grades resting heart rate against the user's own baseline, not an absolute", () => {
    // 58 bpm is unremarkable for one person and a red flag for another. What
    // matters is the distance from that person's own median.
    assert.equal(profile.stateFor("restingHrDelta", 1), "good");
    assert.equal(profile.stateFor("restingHrDelta", 4), "caution");
    assert.equal(profile.stateFor("restingHrDelta", 9), "hard");
  });
});
