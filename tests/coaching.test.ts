import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { forecastLoad } from "../src/detect/forecast.js";
import { analyseSleep } from "../src/detect/sleepQuality.js";
import { nextRace, describeRace } from "../src/detect/countdown.js";
import { buildWeekReview } from "../src/detect/week.js";
import type { DetectorInput } from "../src/detect/findings.js";
import type { ContextEntry } from "../src/history/context.js";
import type { MetricKind } from "../src/history/schema.js";
import type { MetricPoint, StoredActivity } from "../src/history/store.js";

const NOW = DateTime.fromISO("2026-08-19T20:00:00", { zone: "utc" });

/** Oldest-first, landing on the days ending today -- how the store returns them. */
function series(values: number[]): MetricPoint[] {
  const start = NOW.startOf("day").minus({ days: values.length - 1 });
  return values.map((value, index) => ({
    date: start.plus({ days: index }).toISODate() ?? "",
    value,
  }));
}

function input(
  data: Partial<Record<MetricKind, number[]>>,
  activities: StoredActivity[] = []
): DetectorInput {
  return {
    now: NOW,
    series: (kind: MetricKind, days: number) => {
      const values = data[kind] ?? [];
      return series(values).slice(-days);
    },
    activities: () => activities,
  };
}

function repeat(value: number, count: number): number[] {
  return Array.from({ length: count }, () => value);
}

let nextActivityId = 1;

/** One session `daysAgo` days back, sized by duration and heart rate. */
function session(daysAgo: number, minutes: number, avgHr: number): StoredActivity {
  const date = NOW.startOf("day").minus({ days: daysAgo }).toISODate() ?? "";
  return {
    activityId: nextActivityId++,
    date,
    startTimeLocal: `${date}T07:00:00`,
    name: "Run",
    type: "running",
    distanceMeters: 10000,
    durationSeconds: minutes * 60,
    avgHr,
    maxHr: avgHr + 20,
    elevationGainMeters: null,
    calories: null,
    averageSpeedMps: null,
  };
}

/** A heart-rate profile the TRIMP estimator will accept. */
const HR_DATA = { resting_hr: repeat(50, 28), max_hr: repeat(185, 28) };

describe("load forecast", () => {
  it("says nothing when there is not enough history to compare against", () => {
    const forecast = forecastLoad(input({ resting_hr: repeat(50, 5), max_hr: repeat(185, 5) }));

    assert.equal(forecast.verdict, "unknown");
    assert.equal(forecast.projectedRatio, null);
    assert.match(forecast.summary, /Not enough training history/);
  });

  it("returns unknown rather than a ratio when nothing has been trained", () => {
    const forecast = forecastLoad(input(HR_DATA, []));

    assert.equal(forecast.verdict, "unknown");
    assert.equal(forecast.acuteLoad, 0);
  });

  it("projects a spike when this week is far heavier than the four before it", () => {
    // One easy session a week for a month, then a heavy week.
    const history = [session(27, 30, 130), session(20, 30, 130), session(13, 30, 130)];
    const thisWeek = [
      session(1, 90, 165),
      session(3, 90, 165),
      session(5, 90, 165),
      session(6, 90, 165),
    ];

    const forecast = forecastLoad(input(HR_DATA, [...history, ...thisWeek]));

    assert.equal(forecast.verdict, "spike_ahead");
    assert.ok((forecast.projectedRatio ?? 0) > 1.5);
    assert.ok((forecast.weeklyLoadAdjustment ?? 0) < 0, "should say to shed load");
    assert.match(forecast.summary, /extrapolation/);
  });

  it("projects detraining when this week is far lighter than the four before it", () => {
    const history = [
      session(27, 90, 165),
      session(24, 90, 165),
      session(20, 90, 165),
      session(17, 90, 165),
      session(13, 90, 165),
      session(10, 90, 165),
      session(9, 90, 165),
      session(8, 90, 165),
    ];

    const forecast = forecastLoad(input(HR_DATA, history));

    assert.equal(forecast.verdict, "detraining_ahead");
    assert.ok((forecast.weeklyLoadAdjustment ?? 0) > 0, "should say to add load");
  });

  it("slides the chronic window forward rather than holding it still", () => {
    // A heavy oldest week that will drop out of the window, and a steady rest.
    const activities = [
      session(27, 120, 170),
      session(26, 120, 170),
      session(25, 120, 170),
      session(13, 45, 150),
      session(6, 45, 150),
      session(2, 45, 150),
    ];

    const forecast = forecastLoad(input(HR_DATA, activities));

    // Dropping a heavy week out of the denominator raises the projected ratio
    // above today's. Holding chronic fixed would have made them equal.
    assert.ok(forecast.currentRatio !== null && forecast.projectedRatio !== null);
    assert.ok(
      (forecast.projectedRatio ?? 0) > (forecast.currentRatio ?? 0),
      "dropping a heavy week must raise the projection"
    );
    assert.equal(forecast.trajectory, "rising");
  });
});

describe("sleep debt and consistency", () => {
  it("refuses to guess a baseline from under two weeks of nights", () => {
    const quality = analyseSleep(input({ sleep_seconds: repeat(7 * 3600, 5) }));

    assert.equal(quality.habitualHours, null);
    assert.equal(quality.debtHours, null);
    assert.equal(quality.lastNightHours, 7);
    assert.match(quality.summary, /Only 5 nights/);
  });

  it("measures debt against the person's own median, not eight hours", () => {
    // A habitual six-and-a-half-hour sleeper who slept exactly normally.
    const quality = analyseSleep(input({ sleep_seconds: repeat(6.5 * 3600, 28) }));

    assert.equal(quality.habitualHours, 6.5);
    assert.equal(quality.debtHours, 0);
    assert.match(quality.summary, /close to your usual 6.5h/);
  });

  it("reports a debt when the last week runs under the baseline", () => {
    const nights = [...repeat(8 * 3600, 21), ...repeat(6 * 3600, 7)];
    const quality = analyseSleep(input({ sleep_seconds: nights }));

    assert.equal(quality.habitualHours, 8);
    assert.equal(quality.debtHours, 14);
    assert.match(quality.summary, /14h under your own usual/);
  });

  it("reports a surplus rather than a negative debt", () => {
    const nights = [...repeat(6 * 3600, 21), ...repeat(8 * 3600, 7)];
    const quality = analyseSleep(input({ sleep_seconds: nights }));

    assert.ok((quality.debtHours ?? 0) < 0);
    assert.match(quality.summary, /above your own usual/);
  });

  it("separates a steady sleeper from an erratic one of the same average", () => {
    const steady = analyseSleep(input({ sleep_seconds: repeat(7 * 3600, 28) }));

    const alternating = Array.from({ length: 28 }, (_, index) =>
      index % 2 === 0 ? 5 * 3600 : 9 * 3600
    );
    const erratic = analyseSleep(input({ sleep_seconds: alternating }));

    assert.equal(steady.consistency, "steady");
    assert.equal(erratic.consistency, "erratic");
    // Same median, completely different pattern -- the point of the metric.
    assert.equal(steady.habitualHours, erratic.habitualHours);
  });
});

describe("race countdown", () => {
  const entry = (
    kind: ContextEntry["kind"],
    text: string,
    effectiveFrom: string
  ): ContextEntry => ({
    id: 1,
    kind,
    text,
    effectiveFrom,
    effectiveTo: null,
    createdAt: 0,
  });

  it("returns null when nothing is on the calendar", () => {
    assert.equal(nextRace([], "2026-08-19"), null);
    assert.equal(nextRace([entry("goal", "sub 40 10k", "2026-08-01")], "2026-08-19"), null);
  });

  it("ignores races that have already happened", () => {
    const races = [entry("race", "Spring half", "2026-04-12")];
    assert.equal(nextRace(races, "2026-08-19"), null);
  });

  it("picks the nearest future race", () => {
    const races = [
      entry("race", "Autumn marathon", "2026-10-11"),
      entry("race", "Club 5k", "2026-08-30"),
    ];

    const race = nextRace(races, "2026-08-19");

    assert.equal(race?.text, "Club 5k");
    assert.equal(race?.daysAway, 11);
    assert.equal(race?.phase, "taper");
  });

  it("names race day and the day before it", () => {
    assert.equal(nextRace([entry("race", "X", "2026-08-19")], "2026-08-19")?.label, "Today");
    assert.equal(nextRace([entry("race", "X", "2026-08-20")], "2026-08-19")?.label, "Tomorrow");
  });

  it("skips an entry whose date cannot be read rather than guessing one", () => {
    const races = [entry("race", "Someday", "not-a-date")];
    assert.equal(nextRace(races, "2026-08-19"), null);
  });

  it("explains what the phase means for load, and nothing medical", () => {
    const race = nextRace([entry("race", "Club 5k", "2026-08-22")], "2026-08-19");
    const text = describeRace(race) ?? "";

    assert.match(text, /race week/i);
    assert.match(text, /load/i);
    assert.equal(describeRace(null), null);
  });
});

describe("week review", () => {
  it("says it cannot compare when only one week is recorded", () => {
    const review = buildWeekReview(input({ resting_hr: repeat(50, 6) }));

    assert.equal(review.ready, false);
    assert.match(review.headline, /cannot be compared/);
  });

  it("compares this week against last week per metric", () => {
    const review = buildWeekReview(
      input({
        // Oldest seven at 8h, newest seven at 6h.
        sleep_seconds: [...repeat(8 * 3600, 7), ...repeat(6 * 3600, 7)],
        resting_hr: [...repeat(50, 7), ...repeat(54, 7)],
        max_hr: repeat(185, 14),
      })
    );

    assert.equal(review.ready, true);

    const sleep = review.metrics.find((metric) => metric.key === "sleep");
    assert.equal(sleep?.current, 6);
    assert.equal(sleep?.previous, 8);
    assert.equal(sleep?.delta, -2);
    assert.equal(sleep?.direction, "down");
    assert.equal(sleep?.notable, true);

    const rhr = review.metrics.find((metric) => metric.key === "resting_hr");
    assert.equal(rhr?.delta, 4);
    assert.equal(rhr?.direction, "up");
  });

  it("marks a metric unknown rather than showing a delta against nothing", () => {
    const review = buildWeekReview(
      input({
        resting_hr: repeat(50, 14),
        max_hr: repeat(185, 14),
      })
    );

    const hrv = review.metrics.find((metric) => metric.key === "hrv");
    assert.equal(hrv?.current, null);
    assert.equal(hrv?.delta, null);
    assert.equal(hrv?.direction, "unknown");
    assert.equal(hrv?.notable, false);
  });

  it("counts sessions in each week separately", () => {
    const review = buildWeekReview(
      input(
        { resting_hr: repeat(50, 14), max_hr: repeat(185, 14) },
        [session(1, 40, 150), session(3, 40, 150), session(9, 40, 150)]
      )
    );

    assert.equal(review.sessions, 2);
    assert.equal(review.previousSessions, 1);
    assert.equal(review.movingMinutes, 80);
  });

  it("splits the weeks by date, so a missing day cannot shift the boundary", () => {
    // Thirteen days of resting HR, not fourteen: position slicing would put a
    // day from last week into this week.
    const review = buildWeekReview(
      input({
        resting_hr: [...repeat(50, 6), ...repeat(60, 7)],
        max_hr: repeat(185, 13),
      })
    );

    const rhr = review.metrics.find((metric) => metric.key === "resting_hr");
    assert.equal(rhr?.current, 60, "this week is the last seven dates");
    assert.equal(rhr?.previous, 50);
  });
});
