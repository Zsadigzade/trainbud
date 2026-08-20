import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBaseline, meanOf, median, robustZ } from "../src/detect/baseline.js";
import type { MetricPoint } from "../src/history/store.js";

function points(values: number[]): MetricPoint[] {
  return values.map((value, index) => ({
    date: `2026-08-${String(index + 1).padStart(2, "0")}`,
    value,
  }));
}

describe("median", () => {
  it("takes the middle of an odd set", () => {
    assert.equal(median([3, 1, 2]), 2);
  });

  it("averages the two middles of an even set", () => {
    assert.equal(median([1, 2, 3, 4]), 2.5);
  });

  it("returns null for an empty set", () => {
    assert.equal(median([]), null);
  });
});

describe("buildBaseline", () => {
  it("refuses to build from too few points", () => {
    assert.equal(buildBaseline(points([50, 51, 52])), null);
  });

  it("honours a caller's minimum", () => {
    assert.ok(buildBaseline(points([50, 51, 52]), 3));
  });

  it("reports the median, the MAD and the count", () => {
    const baseline = buildBaseline(points([50, 50, 51, 52, 53]), 3);

    assert.equal(baseline?.median, 51);
    assert.equal(baseline?.count, 5);
    assert.equal(baseline?.mad, 1);
  });
});

describe("robustZ", () => {
  it("is positive above the median and negative below", () => {
    const baseline = buildBaseline(points([48, 50, 50, 51, 52]), 3);

    assert.ok((robustZ(56, baseline!) ?? 0) > 0);
    assert.ok((robustZ(44, baseline!) ?? 0) < 0);
  });

  // A perfectly repeatable series gives MAD 0, and dividing by it yields
  // Infinity -- which compares true against every threshold and would fire
  // every detector at once.
  it("returns null rather than Infinity when the series never varies", () => {
    const baseline = buildBaseline(points([50, 50, 50, 50, 50]), 3);

    assert.equal(baseline?.mad, 0);
    assert.equal(robustZ(60, baseline!), null);
  });

  it("scales with distance from the median", () => {
    const baseline = buildBaseline(points([48, 49, 50, 51, 52]), 3);
    const near = robustZ(51, baseline!) ?? 0;
    const far = robustZ(54, baseline!) ?? 0;

    assert.ok(far > near);
  });
});

// The whole reason this file uses median and MAD rather than mean and standard
// deviation: one enormous catch-up sleep after a race must not raise the bar so
// far that the next three short nights read as normal.
describe("robustness to an outlier", () => {
  it("moves the median far less than the mean", () => {
    const normal = [7, 7.2, 6.8, 7.1, 6.9, 7, 7.1];
    const withOutlier = [...normal, 12];

    const medianShift = Math.abs((median(withOutlier) ?? 0) - (median(normal) ?? 0));
    const meanShift = Math.abs(
      (meanOf(points(withOutlier)) ?? 0) - (meanOf(points(normal)) ?? 0)
    );

    assert.ok(
      medianShift < meanShift,
      `median moved ${medianShift}, mean moved ${meanShift}`
    );
  });
});

describe("meanOf", () => {
  it("averages the points", () => {
    assert.equal(meanOf(points([2, 4, 6])), 4);
  });

  it("returns null for no points", () => {
    assert.equal(meanOf([]), null);
  });
});
