import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { StoredActivity } from "../src/history/store.js";
import {
  compareWorkouts,
  findComparableWorkouts,
  renderWorkoutComparison,
} from "../src/detect/compare.js";

/**
 * "Workout comparison" was the last unchecked item on the README roadmap.
 *
 * The rule the rest of this codebase is built on applies here too: a missing
 * measurement is `unknown`, never zero. A run whose heart-rate strap dropped
 * out must not be reported as 40 bpm below the last one, and a comparison
 * against nothing at all has to say so rather than inventing a baseline of
 * zero -- the same confusion that produced two real bugs in recovery.
 */
function activity(overrides: Partial<StoredActivity> & { activityId: number }): StoredActivity {
  return {
    date: "2026-09-01",
    startTimeLocal: "2026-09-01 07:00:00",
    name: "Run",
    type: "running",
    distanceMeters: 5000,
    durationSeconds: 1500,
    avgHr: 150,
    maxHr: 170,
    elevationGainMeters: 20,
    calories: 400,
    averageSpeedMps: 3.33,
    ...overrides,
  };
}

describe("choosing what a workout is comparable to", () => {
  const subject = activity({ activityId: 100, date: "2026-09-07", distanceMeters: 5000 });

  it("keeps only earlier workouts of the same type", () => {
    const pool = [
      subject,
      activity({ activityId: 1, date: "2026-09-01", type: "cycling", distanceMeters: 5000 }),
      activity({ activityId: 2, date: "2026-09-02", distanceMeters: 5100 }),
      activity({ activityId: 3, date: "2026-09-09", distanceMeters: 5000 }),
    ];

    const found = findComparableWorkouts(subject, pool);

    assert.deepEqual(
      found.map((a) => a.activityId),
      [2],
      "a different sport, a later date and the workout itself are all excluded"
    );
  });

  it("rejects a workout of a very different distance", () => {
    const pool = [
      activity({ activityId: 4, date: "2026-09-02", distanceMeters: 5400 }),
      activity({ activityId: 5, date: "2026-09-03", distanceMeters: 12000 }),
      activity({ activityId: 6, date: "2026-09-04", distanceMeters: 800 }),
    ];

    const found = findComparableWorkouts(subject, pool);

    assert.deepEqual(found.map((a) => a.activityId), [4]);
  });

  it("orders by closeness of distance, so the first is the most like it", () => {
    const pool = [
      activity({ activityId: 7, date: "2026-09-02", distanceMeters: 5500 }),
      activity({ activityId: 8, date: "2026-09-03", distanceMeters: 5010 }),
      activity({ activityId: 9, date: "2026-09-04", distanceMeters: 4700 }),
    ];

    assert.deepEqual(
      findComparableWorkouts(subject, pool).map((a) => a.activityId),
      [8, 9, 7]
    );
  });

  it("falls back to duration when the sport records no distance", () => {
    const strength = activity({
      activityId: 200,
      date: "2026-09-07",
      type: "strength_training",
      distanceMeters: 0,
      durationSeconds: 3600,
    });
    const pool = [
      activity({ activityId: 10, date: "2026-09-01", type: "strength_training", distanceMeters: 0, durationSeconds: 3500 }),
      activity({ activityId: 11, date: "2026-09-02", type: "strength_training", distanceMeters: 0, durationSeconds: 600 }),
    ];

    assert.deepEqual(
      findComparableWorkouts(strength, pool).map((a) => a.activityId),
      [10],
      "a ten minute session is not a comparison for an hour"
    );
  });
});

describe("comparing a workout with the ones like it", () => {
  const subject = activity({
    activityId: 100,
    date: "2026-09-07",
    distanceMeters: 5000,
    durationSeconds: 1500,
    avgHr: 150,
  });

  it("reports the deltas against the closest previous workout", () => {
    const closest = activity({
      activityId: 2,
      date: "2026-09-01",
      distanceMeters: 5000,
      durationSeconds: 1600,
      avgHr: 155,
    });

    const result = compareWorkouts(subject, [closest]);

    assert.equal(result.closest?.activityId, 2);
    assert.equal(result.metrics.duration.state, "known");
    assert.equal(result.metrics.duration.delta, -100);
    assert.equal(result.metrics.duration.direction, "lower");
    assert.equal(result.metrics.avgHr.delta, -5);
    // 1500s over 5km is 300 s/km; 1600s over 5km is 320.
    assert.equal(result.metrics.pace.current, 300);
    assert.equal(result.metrics.pace.reference, 320);
    assert.equal(result.metrics.pace.direction, "faster");
  });

  it("calls a missing measurement unknown rather than a delta from zero", () => {
    const closest = activity({ activityId: 3, date: "2026-09-01", avgHr: null });

    const result = compareWorkouts(subject, [closest]);

    assert.equal(result.metrics.avgHr.state, "unknown");
    assert.equal(result.metrics.avgHr.delta, null);
  });

  it("says so when there is nothing comparable at all", () => {
    const result = compareWorkouts(subject, []);

    assert.equal(result.closest, null);
    assert.equal(result.comparableCount, 0);
    assert.match(renderWorkoutComparison(result), /no comparable/i);
  });

  it("needs three samples before it will quote a typical value", () => {
    const two = [
      activity({ activityId: 4, date: "2026-09-01", durationSeconds: 1600 }),
      activity({ activityId: 5, date: "2026-09-02", durationSeconds: 1700 }),
    ];

    assert.equal(compareWorkouts(subject, two).metrics.duration.typical, null);

    const three = [...two, activity({ activityId: 6, date: "2026-09-03", durationSeconds: 1800 })];

    assert.equal(compareWorkouts(subject, three).metrics.duration.typical, 1700);
  });

  it("renders something a person can read", () => {
    const closest = activity({ activityId: 7, date: "2026-09-01", durationSeconds: 1600, avgHr: 155 });
    const text = renderWorkoutComparison(compareWorkouts(subject, [closest]));

    assert.match(text, /2026-09-01/);
    assert.match(text, /faster|slower/);
    assert.doesNotMatch(text, /NaN|undefined|Infinity/);
  });
  it("says which one it means when both happened the same day", () => {
    // Three treadmill intervals in one session is normal, and "compared with
    // 2026-09-07" is useless when the subject is also 2026-09-07.
    const morning = activity({
      activityId: 8,
      date: "2026-09-07",
      startTimeLocal: "2026-09-07 06:10:00",
      durationSeconds: 1600,
    });
    const later = activity({
      activityId: 9,
      date: "2026-09-07",
      startTimeLocal: "2026-09-07 18:40:00",
      durationSeconds: 1500,
    });

    const text = renderWorkoutComparison(compareWorkouts(later, [morning]));

    assert.match(text, /06:10/, "the earlier workout needs a time, not just a date");
  });
  it("speaks miles and feet when the profile says imperial", () => {
    // The profile carries a units setting and the rest of the app honours it.
    // A comparison that always answers in km is wrong for half its readers.
    const closest = activity({ activityId: 12, date: "2026-09-01", durationSeconds: 1600 });
    const comparison = compareWorkouts(subject, [closest]);

    const metric = renderWorkoutComparison(comparison, "metric");
    const imperial = renderWorkoutComparison(comparison, "imperial");

    assert.match(metric, /\/km/);
    assert.doesNotMatch(metric, /\/mi\b/);

    assert.match(imperial, /\/mi\b/);
    assert.doesNotMatch(imperial, /\/km/);
    // 300 s/km is 8m 03s per mile.
    assert.match(imperial, /8m 03s\/mi/);
  });

  it("reports elevation in feet for an imperial profile", () => {
    const closest = activity({ activityId: 13, date: "2026-09-01", elevationGainMeters: 10 });
    const text = renderWorkoutComparison(compareWorkouts(subject, [closest]), "imperial");

    assert.match(text, /ft/);
    assert.doesNotMatch(text, /\d+ m\b/);
  });
});

describe("explaining why there is nothing to compare against", () => {
  const subject = activity({
    activityId: 100,
    date: "2026-09-07",
    type: "running",
    distanceMeters: 1500,
    durationSeconds: 500,
  });

  it("says it is the first of its kind when it truly is", () => {
    const text = renderWorkoutComparison(
      compareWorkouts(subject, [], { earlierSameType: 0, nearest: null })
    );

    assert.match(text, /first/i);
    assert.doesNotMatch(text, /nearest/i);
  });

  it("does not claim a first when nine earlier runs exist at other distances", () => {
    // Measured on real history: a 1.5 km run with nine earlier runs, the nearest
    // 3.3 km. Telling that user "this is the first one that qualifies" is false
    // in the way that matters -- they have plenty of runs, just not this one.
    const nearest = activity({
      activityId: 42,
      date: "2026-07-01",
      type: "running",
      distanceMeters: 3349,
    });

    const text = renderWorkoutComparison(
      compareWorkouts(subject, [], { earlierSameType: 9, nearest })
    );

    assert.doesNotMatch(text, /first/i);
    assert.match(text, /9 earlier running/i);
    assert.match(text, /3\.3 km|3349/);
    assert.match(text, /2026-07-01/);
  });

  it("keeps the count and the nearest on the result for a caller that wants them", () => {
    const nearest = activity({ activityId: 43, date: "2026-07-01", distanceMeters: 3349 });
    const result = compareWorkouts(subject, [], { earlierSameType: 9, nearest });

    assert.equal(result.earlierSameType, 9);
    assert.equal(result.nearest?.activityId, 43);
  });

  it("still works when a caller passes no context at all", () => {
    assert.doesNotThrow(() => renderWorkoutComparison(compareWorkouts(subject, [])));
  });
});

describe("the numbers on screen add up", () => {
  it("derives the shown difference from the shown endpoints", () => {
    // Real output before this: "Elevation: 24 m vs 38 m — 15 m lower". Each
    // endpoint is rounded for display and the delta was rounded separately, so
    // the three numbers on one line disagreed. In a product whose whole claim is
    // that the arithmetic is done in code, that is the worst kind of small bug.
    const subject = activity({
      activityId: 300,
      date: "2026-09-07",
      elevationGainMeters: 23.6,
    });
    const closest = activity({
      activityId: 301,
      date: "2026-09-01",
      elevationGainMeters: 38.4,
    });

    const text = renderWorkoutComparison(compareWorkouts(subject, [closest]));
    const line = text.split("\n").find((row) => row.includes("Elevation"));

    assert.ok(line, "no elevation line rendered");
    assert.match(line, /24 m vs 38 m/);
    assert.match(line, /14 m lower/, `endpoints say 14, the line said: ${line}`);
  });

  it("keeps the unrounded delta on the payload for callers that want it", () => {
    const subject = activity({ activityId: 302, date: "2026-09-07", avgHr: 150.4 });
    const closest = activity({ activityId: 303, date: "2026-09-01", avgHr: 155.6 });

    const result = compareWorkouts(subject, [closest]);

    assert.equal(result.metrics.avgHr.delta, -5.2);
  });
});
