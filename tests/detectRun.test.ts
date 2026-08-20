import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { runDetectors } from "../src/detect/index.js";
import type { DetectorInput } from "../src/detect/findings.js";
import type { MetricKind } from "../src/history/schema.js";
import type { MetricPoint, StoredActivity } from "../src/history/store.js";

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
  activities: StoredActivity[] = []
): DetectorInput {
  return {
    now: NOW,
    series: (kind: MetricKind, days: number) => (series(data[kind] ?? [])).slice(-days),
    activities: () => activities,
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
