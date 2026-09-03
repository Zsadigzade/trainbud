import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { buildWeekReview } from "../src/detect/week.js";
import type { DetectorInput } from "../src/detect/findings.js";
import type { MetricKind } from "../src/history/schema.js";
import type { MetricPoint, StoredActivity } from "../src/history/store.js";

// "This week against last week" was this week against the eight days before it.
//
// `series(kind, 14)` spans `today - 14 .. today` inclusive, which is FIFTEEN
// calendar days. Split at `today - 7`, the halves come out 7 and 8: every
// wellness metric and the session count compared a seven-day week to an
// eight-day one. The TRIMP load line beside them sums two explicit seven-day
// windows and was always right -- so one card disagreed with itself, and the
// half that was wrong is the half a reader is most likely to quote.
//
// A whole day of extra sessions on the "last week" side is not a rounding
// error: on any regular schedule it makes this week look like a step down.

const NOW = DateTime.fromISO("2026-09-03T20:00:00", { zone: "utc" });
const TODAY = NOW.startOf("day");

const iso = (daysAgo: number): string => TODAY.minus({ days: daysAgo }).toISODate() ?? "";

/** One point per day for the whole window the caller asks for, oldest first. */
function everyDay(days: number, valueFor: (daysAgo: number) => number): MetricPoint[] {
  const points: MetricPoint[] = [];
  for (let daysAgo = days; daysAgo >= 0; daysAgo -= 1) {
    points.push({ date: iso(daysAgo), value: valueFor(daysAgo) });
  }
  return points;
}

let nextId = 1;

function session(daysAgo: number): StoredActivity {
  return {
    activityId: nextId++,
    date: iso(daysAgo),
    startTimeLocal: `${iso(daysAgo)}T07:00:00`,
    name: "Run",
    type: "running",
    distanceMeters: 8000,
    durationSeconds: 2400,
    avgHr: 140,
    maxHr: 165,
    elevationGainMeters: 20,
    calories: 400,
    averageSpeedMps: 3.3,
  };
}

/** Plausible per-kind values, so the TRIMP heart-rate profile can form. */
const VALUE: Partial<Record<MetricKind, number>> = {
  sleep_seconds: 25_200,
  resting_hr: 50,
  max_hr: 185,
  hrv_overnight: 60,
  stress_avg: 30,
};

/** A person who trains and sleeps every single day, for a month. */
function input(): DetectorInput {
  return {
    now: NOW,
    series: (kind: MetricKind, days: number) => everyDay(days, () => VALUE[kind] ?? 1),
    activities: (days: number) =>
      Array.from({ length: days + 1 }, (_, daysAgo) => session(daysAgo)),
  };
}

describe("a week is seven days on both sides", () => {
  it("counts the same number of sessions this week and last week", () => {
    const review = buildWeekReview(input());

    assert.equal(review.sessions, 7);
    assert.equal(
      review.previousSessions,
      7,
      "the previous window ran from today-14, which is eight days, not seven"
    );
  });

  it("reports equal moving time for two identical weeks", () => {
    const review = buildWeekReview(input());

    assert.equal(review.movingMinutes, review.previousMovingMinutes);
  });

  it("agrees with the load line, which always used two seven-day windows", () => {
    const review = buildWeekReview(input());
    const load = review.metrics.find((metric) => metric.key === "load");

    assert.ok(load, "the load metric should be present with a heart-rate profile");
    // Identical weeks: the sum over each is the same, so the delta is zero.
    // Before, `sessions` said 7 vs 8 while this said the weeks were equal.
    assert.equal(load.delta, 0);
  });

  it("puts the start of the window seven days before the end", () => {
    const review = buildWeekReview(input());

    const start = DateTime.fromISO(review.start);
    const end = DateTime.fromISO(review.end);
    assert.equal(end.diff(start, "days").days, 6, "start..end inclusive must be seven days");
  });
});
