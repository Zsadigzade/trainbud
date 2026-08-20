import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import {
  detectHrvTrendBreak,
  detectRestingHrElevation,
  detectSleepDebt,
} from "../src/detect/detectors.js";
import type { DetectorInput } from "../src/detect/findings.js";
import type { MetricKind } from "../src/history/schema.js";
import type { MetricPoint, StoredActivity } from "../src/history/store.js";

const NOW = DateTime.fromISO("2026-08-19T20:00:00", { zone: "utc" });

/**
 * Values are given oldest-first and land on the days ending yesterday, which is
 * how the store returns them.
 */
function series(values: number[]): MetricPoint[] {
  const start = NOW.startOf("day").minus({ days: values.length });

  return values.map((value, index) => ({
    date: start.plus({ days: index + 1 }).toISODate() ?? "",
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

/** A believable resting series: stable around 50 with a little night-to-night noise. */
function steadyResting(count: number): number[] {
  return Array.from({ length: count }, (_, index) => 50 + (index % 3) - 1);
}

describe("resting HR elevation", () => {
  it("fires when the last three days are all clearly above baseline", () => {
    const finding = detectRestingHrElevation(
      input({ resting_hr: [...steadyResting(28), 56, 57, 56] })
    );

    assert.equal(finding?.kind, "rhr_elevated");
    assert.equal(finding?.values.days, 3);
    assert.ok((finding?.values.deltaBpm ?? 0) >= 3);
    assert.match(finding?.headline ?? "", /resting heart rate/i);
    // The headline reports the measurement, never a cause.
    assert.doesNotMatch(finding?.headline ?? "", /ill|sick|infection|overtrain/i);
  });

  // One high morning is a late meal or a warm room. Two is still not a pattern.
  it("stays silent on a two-day run", () => {
    const finding = detectRestingHrElevation(
      input({ resting_hr: [...steadyResting(28), 50, 57, 56] })
    );

    assert.equal(finding, null);
  });

  // Otherwise a very consistent sleeper is flagged over a 1 bpm move that
  // happens to be statistically enormous.
  it("stays silent when the rise is statistically large but physiologically tiny", () => {
    const finding = detectRestingHrElevation(
      input({ resting_hr: [...steadyResting(28), 52, 52, 52] })
    );

    assert.equal(finding, null);
  });

  it("returns null without enough baseline history", () => {
    assert.equal(detectRestingHrElevation(input({ resting_hr: [50, 51, 56, 57, 56] })), null);
  });

  it("returns null on a series that never varies at all", () => {
    const finding = detectRestingHrElevation(
      input({ resting_hr: [...repeat(50, 28), 56, 57, 56] })
    );

    assert.equal(finding, null);
  });
});

describe("sleep debt", () => {
  it("fires when the week falls well short of the personal median", () => {
    const finding = detectSleepDebt(
      input({ sleep_seconds: [...repeat(7.5 * 3600, 28), ...repeat(6 * 3600, 7)] })
    );

    assert.equal(finding?.kind, "sleep_debt");
    assert.ok((finding?.values.debtHours ?? 0) >= 3);
  });

  // Measured against your own median, not against eight hours, so a genuine
  // short sleeper is not permanently in debt.
  it("stays silent for a consistent short sleeper", () => {
    const finding = detectSleepDebt(
      input({ sleep_seconds: repeat(6 * 3600, 35) })
    );

    assert.equal(finding, null);
  });

  it("stays silent for a week only slightly under", () => {
    const finding = detectSleepDebt(
      input({ sleep_seconds: [...repeat(7.5 * 3600, 28), ...repeat(7.2 * 3600, 7)] })
    );

    assert.equal(finding, null);
  });

  it("returns null without enough baseline history", () => {
    assert.equal(detectSleepDebt(input({ sleep_seconds: repeat(6 * 3600, 8) })), null);
  });
});

describe("HRV trend break", () => {
  it("fires when the last three nights drop well below baseline", () => {
    const finding = detectHrvTrendBreak(
      input({ hrv_overnight: [...steadyResting(28).map((v) => v - 5), 30, 29, 31] })
    );

    assert.equal(finding?.kind, "hrv_trend_break");
    assert.ok((finding?.values.recentMedian ?? 0) < (finding?.values.baseline ?? 0));
  });

  // A mean would be dragged under the threshold by this one night alone.
  it("stays silent on a single low night", () => {
    const finding = detectHrvTrendBreak(
      input({ hrv_overnight: [...steadyResting(28).map((v) => v - 5), 45, 44, 29] })
    );

    assert.equal(finding, null);
  });

  it("returns null without enough baseline history", () => {
    assert.equal(detectHrvTrendBreak(input({ hrv_overnight: [44, 45, 29, 30, 31] })), null);
  });

  it("reads measured overnight HRV, not any composite score", () => {
    // No hrv_overnight in the store means no finding, even though the recovery
    // score would happily have produced one.
    assert.equal(detectHrvTrendBreak(input({ resting_hr: steadyResting(35) })), null);
  });
});
