import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { runDetectors } from "../src/detect/index.js";
import type { DetectorInput } from "../src/detect/findings.js";
import type { MetricKind } from "../src/history/schema.js";
import type { MetricPoint, StoredActivity } from "../src/history/store.js";
import type { ContextEntry } from "../src/history/context.js";

const NOW = DateTime.fromISO("2026-08-19T20:00:00", { zone: "utc" });

function series(values: number[]): MetricPoint[] {
  const start = NOW.startOf("day").minus({ days: values.length });

  return values.map((value, index) => ({
    date: start.plus({ days: index + 1 }).toISODate() ?? "",
    value,
  }));
}

function input(
  data: Partial<Record<MetricKind, number[]>>,
  activities: StoredActivity[] = [],
  context: ContextEntry[] = []
): DetectorInput {
  return {
    now: NOW,
    series: (kind: MetricKind, days: number) => (series(data[kind] ?? [])).slice(-days),
    activities: () => activities,
    context: () => context,
  };
}

/** The elevation that earns a `warn`, so the alert badge has something to drop. */
const RAISED_RHR: Partial<Record<MetricKind, number[]>> = {
  resting_hr: [...noisy(50, 28), 58, 59, 58],
  sleep_seconds: repeat(7.5 * 3600, 35),
  hrv_overnight: noisy(45, 31),
};

function muting(mutes: string[]): ContextEntry {
  return {
    id: 4,
    kind: "note",
    text: "travelling",
    effectiveFrom: NOW.minus({ days: 2 }).toISODate() ?? "",
    effectiveTo: NOW.plus({ days: 12 }).toISODate() ?? "",
    createdAt: 0,
    mutes,
  };
}

function repeat(value: number, count: number): number[] {
  return Array.from({ length: count }, () => value);
}

function noisy(base: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => base + (index % 3) - 1);
}

describe("runDetectors", () => {
  // The cold start is a first-class case: an empty store must read as "still
  // gathering", never as an empty card or a clean bill of health.
  it("reports not ready on an empty store", () => {
    const result = runDetectors(input({}));

    assert.deepEqual(result.findings, []);
    assert.equal(result.coverage.ready, false);
    assert.equal(result.coverage.days, 0);
  });

  it("is still not ready with under two weeks of data", () => {
    const result = runDetectors(input({ resting_hr: noisy(50, 10) }));

    assert.equal(result.coverage.ready, false);
    assert.equal(result.coverage.days, 10);
  });

  // The distinction every surface depends on: nothing wrong is not the same
  // answer as nothing known.
  it("is ready and silent on a month of unremarkable data", () => {
    const result = runDetectors(
      input({
        resting_hr: noisy(50, 31),
        sleep_seconds: repeat(7.5 * 3600, 35),
        hrv_overnight: noisy(45, 31),
      })
    );

    assert.deepEqual(result.findings, []);
    assert.equal(result.coverage.ready, true);
  });

  it("returns several findings at once, worst first", () => {
    const result = runDetectors(
      input({
        // A big elevation earns `warn`; the sleep debt below earns `notice`.
        resting_hr: [...noisy(50, 28), 58, 59, 58],
        sleep_seconds: [...repeat(7.5 * 3600, 28), ...repeat(6.5 * 3600, 7)],
        hrv_overnight: noisy(45, 31),
      })
    );

    assert.ok(result.findings.length >= 2);
    assert.equal(result.findings[0]?.severity, "warn");
    assert.ok(result.findings.every((finding) => finding.headline.length > 0));
  });

  // The watch shows the first couple. Reordering them between syncs would read
  // as the data having changed when it has not.
  it("orders findings identically on repeated calls", () => {
    const data = {
      resting_hr: [...noisy(50, 28), 58, 59, 58],
      sleep_seconds: [...repeat(7.5 * 3600, 28), ...repeat(6.5 * 3600, 7)],
      hrv_overnight: noisy(45, 31),
    };

    const first = runDetectors(input(data)).findings.map((finding) => finding.kind);
    const second = runDetectors(input(data)).findings.map((finding) => finding.kind);

    assert.deepEqual(first, second);
  });

  it("counts coverage from the longest series it has", () => {
    const result = runDetectors(
      input({ resting_hr: noisy(50, 5), sleep_seconds: repeat(7 * 3600, 20) })
    );

    assert.equal(result.coverage.days, 20);
    assert.equal(result.coverage.ready, true);
  });
});

// The whole point of the feature, proved through the real pipeline rather than
// against applyMutes on its own: a user who explained something stops being told
// about it, everywhere, and nothing about the measurement is lost.
describe("a finding the user has explained", () => {
  it("stands out when nothing has been recorded", () => {
    const result = runDetectors(input(RAISED_RHR));

    assert.deepEqual(
      result.findings.map((each) => each.kind),
      ["rhr_elevated"]
    );
    assert.deepEqual(result.muted, []);
  });

  it("leaves the live list once an entry mutes its kind", () => {
    const result = runDetectors(input(RAISED_RHR, [], [muting(["rhr_elevated"])]));

    assert.deepEqual(result.findings, []);
    assert.deepEqual(
      result.muted.map((each) => each.kind),
      ["rhr_elevated"]
    );
  });

  it("keeps its numbers and names who muted it", () => {
    const result = runDetectors(input(RAISED_RHR, [], [muting(["rhr_elevated"])]));

    assert.equal(result.muted[0]?.severity, "warn");
    assert.ok((result.muted[0]?.values.deltaBpm ?? 0) > 0);
    assert.equal(result.muted[0]?.mutedBy.text, "travelling");
  });

  it("is not muted by an entry that only records something", () => {
    const result = runDetectors(input(RAISED_RHR, [], [muting([])]));

    assert.equal(result.findings.length, 1);
    assert.equal(result.muted.length, 0);
  });

  it("still reports coverage as ready, so silence is not read as a cold start", () => {
    const result = runDetectors(input(RAISED_RHR, [], [muting(["*"])]));

    assert.equal(result.coverage.ready, true);
    assert.deepEqual(result.findings, []);
    assert.equal(result.muted.length, 1);
  });
});
