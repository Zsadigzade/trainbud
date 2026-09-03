import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { analyseSleep } from "../src/detect/sleepQuality.js";
import type { DetectorInput } from "../src/detect/findings.js";
import type { MetricKind } from "../src/history/schema.js";
import type { MetricPoint } from "../src/history/store.js";

// `detectors.ts` fixed this and its sibling did not.
//
//     const debtWindow = hours.slice(-DEBT_WINDOW_DAYS);
//
// `slice(-7)` takes the last seven POINTS, and seven points are seven nights
// only when the store has no holes -- which it routinely does, because a night
// gets a row only when the watch was worn. `split()` in detectors.ts carries a
// long comment about exactly this, added when a resting heart rate elevated in
// June was reported as "3 days running" in August. The same slice survived
// here.
//
// On the live store, which ends 2026-08-21, `analyseSleep` on 2026-09-03
// reported Aug 21's sleep as "last night" and computed a debt over Aug 15-21
// while calling it "the last 7 nights".

const NOW = DateTime.fromISO("2026-09-03T20:00:00", { zone: "utc" });
const TODAY = NOW.startOf("day");

const iso = (daysAgo: number): string => TODAY.minus({ days: daysAgo }).toISODate() ?? "";

/** Nights at the given ages, oldest first, as the store returns them. */
function nights(entries: Array<{ daysAgo: number; hours: number }>): MetricPoint[] {
  return entries
    .map(({ daysAgo, hours }) => ({ date: iso(daysAgo), value: hours * 3600 }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function input(points: MetricPoint[]): DetectorInput {
  return {
    now: NOW,
    series: (kind: MetricKind, days: number) => {
      if (kind !== "sleep_seconds") {
        return [];
      }
      const from = iso(days);
      return points.filter((point) => point.date >= from);
    },
    activities: () => [],
  };
}

/** A record that stops thirteen days ago, like the live install. */
function staleRecord(): MetricPoint[] {
  return nights(
    Array.from({ length: 20 }, (_, index) => ({ daysAgo: 13 + index, hours: 7 }))
  );
}

/** A record that is current. */
function currentRecord(hoursFor: (daysAgo: number) => number): MetricPoint[] {
  return nights(Array.from({ length: 28 }, (_, daysAgo) => ({ daysAgo, hours: hoursFor(daysAgo) })));
}

describe("sleep windows are measured in days, not in array positions", () => {
  it("does not call a fortnight-old night 'last night'", () => {
    const quality = analyseSleep(input(staleRecord()));

    assert.equal(
      quality.lastNightHours,
      null,
      "the newest row is 13 days old; reporting it as last night is a false statement about today"
    );
  });

  it("states no sleep debt when no night in the last week was recorded", () => {
    const quality = analyseSleep(input(staleRecord()));

    assert.equal(quality.debtHours, null);
    assert.equal(quality.nightsCounted, 0);
    assert.doesNotMatch(quality.summary, /last 7 nights/);
  });

  it("says the record is out of date rather than describing a week it cannot see", () => {
    const quality = analyseSleep(input(staleRecord()));

    assert.match(quality.summary, /no nights/i);
  });

  it("still reports a debt on a current record", () => {
    // Habitual eight hours; the last week at six.
    const quality = analyseSleep(
      input(currentRecord((daysAgo) => (daysAgo < 7 ? 6 : 8)))
    );

    assert.equal(quality.habitualHours, 8);
    assert.equal(quality.nightsCounted, 7);
    assert.ok(quality.debtHours !== null && quality.debtHours > 0);
    assert.equal(quality.lastNightHours, 6);
  });

  it("counts only the nights inside the window, holes and all", () => {
    // Four of the last seven nights recorded, the rest of the month complete.
    const points = nights([
      ...[0, 1, 4, 6].map((daysAgo) => ({ daysAgo, hours: 5 })),
      ...Array.from({ length: 20 }, (_, index) => ({ daysAgo: index + 7, hours: 8 })),
    ]);

    const quality = analyseSleep(input(points));

    assert.equal(quality.nightsCounted, 4, "seven array positions is not seven nights");
    assert.match(quality.summary, /4 recorded nights/);
  });

  it("measures consistency over the last fourteen days, not the last fourteen rows", () => {
    // Seven wildly varying nights inside the window, and a metronomic stretch
    // that sits entirely outside it.
    //
    // `slice(-14)` would take those seven plus seven of the steady nights: the
    // deviations come out mostly zero, the median absolute deviation lands at
    // half an hour, and a genuinely erratic fortnight reports as "steady". By
    // date, only the seven count.
    const points = nights([
      ...[4, 5, 6, 8, 9, 10, 11].map((hours, daysAgo) => ({ daysAgo, hours })),
      ...Array.from({ length: 14 }, (_, index) => ({ daysAgo: index + 15, hours: 8 })),
    ]);

    const quality = analyseSleep(input(points));

    assert.equal(quality.consistency, "erratic");
    assert.equal(quality.variationMinutes, 120);
  });
});
