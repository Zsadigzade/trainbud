import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dailyTrimp, estimateHrProfile, trimpFor } from "../src/detect/trimp.js";
import type { MetricPoint, StoredActivity } from "../src/history/store.js";

const PROFILE = { restingHr: 50, maxHr: 190 };

function activity(overrides: Partial<StoredActivity> = {}): StoredActivity {
  return {
    activityId: 1,
    date: "2026-08-19",
    startTimeLocal: "2026-08-19 07:30:00",
    name: "Morning Run",
    type: "running",
    distanceMeters: 5200,
    durationSeconds: 1800,
    avgHr: 140,
    maxHr: 171,
    elevationGainMeters: 42,
    calories: 310,
    averageSpeedMps: 2.7,
    ...overrides,
  };
}

function points(values: number[]): MetricPoint[] {
  return values.map((value, index) => ({
    date: `2026-08-${String(index + 1).padStart(2, "0")}`,
    value,
  }));
}

describe("trimpFor", () => {
  it("scores about nothing for a session spent at resting heart rate", () => {
    const score = trimpFor(activity({ avgHr: 50 }), PROFILE) ?? -1;

    assert.ok(score >= 0 && score < 1, `expected ~0, got ${score}`);
  });

  it("scales with duration at the same intensity", () => {
    const short = trimpFor(activity({ durationSeconds: 1800 }), PROFILE) ?? 0;
    const long = trimpFor(activity({ durationSeconds: 3600 }), PROFILE) ?? 0;

    assert.ok(Math.abs(long - short * 2) < 0.001, `${long} should be twice ${short}`);
  });

  it("scores a harder session above an easier one of equal length", () => {
    const easy = trimpFor(activity({ avgHr: 120 }), PROFILE) ?? 0;
    const hard = trimpFor(activity({ avgHr: 170 }), PROFILE) ?? 0;

    assert.ok(hard > easy, `${hard} should exceed ${easy}`);
  });

  // A strength session Garmin recorded without a heart rate must contribute
  // nothing, not a zero -- a zero is a claim that the session was easy.
  it("returns null when the activity carries no average heart rate", () => {
    assert.equal(trimpFor(activity({ avgHr: null }), PROFILE), null);
  });

  it("returns null when the activity carries no duration", () => {
    assert.equal(trimpFor(activity({ durationSeconds: null }), PROFILE), null);
  });

  it("clamps an average above the estimated maximum instead of exploding", () => {
    const score = trimpFor(activity({ avgHr: 210 }), PROFILE) ?? 0;
    const atMax = trimpFor(activity({ avgHr: 190 }), PROFILE) ?? 0;

    assert.ok(Number.isFinite(score));
    assert.equal(score, atMax);
  });

  it("clamps an average below resting rather than going negative", () => {
    const score = trimpFor(activity({ avgHr: 30 }), PROFILE) ?? -1;

    assert.equal(score, 0);
  });
});

describe("estimateHrProfile", () => {
  it("returns null with nothing to estimate from", () => {
    assert.equal(estimateHrProfile([], []), null);
  });

  it("takes the lowest recorded resting rate and the highest observed maximum", () => {
    const profile = estimateHrProfile(points([52, 50, 54]), points([165, 178, 171]));

    assert.equal(profile?.restingHr, 50);
    assert.equal(profile?.maxHr, 178);
  });

  it("refuses a profile whose maximum does not exceed its resting rate", () => {
    assert.equal(estimateHrProfile(points([180]), points([170])), null);
  });
});

describe("dailyTrimp", () => {
  it("sums two sessions on the same day into one entry", () => {
    const one = activity({ activityId: 1 });
    const two = activity({ activityId: 2, startTimeLocal: "2026-08-19 18:00:00" });
    const single = trimpFor(one, PROFILE) ?? 0;

    const byDay = dailyTrimp([one, two], PROFILE);

    assert.equal(byDay.size, 1);
    assert.ok(Math.abs((byDay.get("2026-08-19") ?? 0) - single * 2) < 0.001);
  });

  it("keeps days apart", () => {
    const byDay = dailyTrimp(
      [activity({ activityId: 1 }), activity({ activityId: 2, date: "2026-08-18" })],
      PROFILE
    );

    assert.equal(byDay.size, 2);
  });

  it("omits a day whose only activity had no heart rate", () => {
    const byDay = dailyTrimp([activity({ avgHr: null })], PROFILE);

    assert.equal(byDay.size, 0);
  });
});
