import type { MetricPoint } from "../history/store.js";

// SECTION: Robust baselines
//
// Every detector compares a recent value against the user's own history rather
// than against a population figure, so the shape of "normal" has to come from
// the series itself.
//
// Median and median-absolute-deviation, not mean and standard deviation. Both
// of those are dragged by exactly the outlier a detector most wants to notice:
// one 11-hour recovery sleep after a race lifts the mean and inflates the
// deviation, so the bar rises and the next three short nights read as normal.
// The median ignores it.

/** Makes MAD comparable to a standard deviation for normally distributed data. */
const MAD_TO_SIGMA = 0.6745;

/** Two weeks is the least that describes a person rather than a fortnight's mood. */
const DEFAULT_MINIMUM_COUNT = 14;

export interface Baseline {
  median: number;
  mad: number;
  count: number;
}

export function median(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);

  if (sorted.length === 0) {
    return null;
  }

  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }

  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function buildBaseline(
  points: MetricPoint[],
  minimumCount = DEFAULT_MINIMUM_COUNT
): Baseline | null {
  const values = points.map((point) => point.value).filter((value) => Number.isFinite(value));

  if (values.length < minimumCount) {
    return null;
  }

  const centre = median(values);
  if (centre === null) {
    return null;
  }

  const deviations = values.map((value) => Math.abs(value - centre));

  return {
    median: centre,
    mad: median(deviations) ?? 0,
    count: values.length,
  };
}

/**
 * Returns null when the series never varies. A MAD of zero divides to Infinity,
 * which compares true against every threshold and would fire every detector at
 * once on the most stable data in the store -- the exact opposite of what the
 * data says.
 */
export function robustZ(value: number, baseline: Baseline): number | null {
  if (baseline.mad <= 0 || !Number.isFinite(value)) {
    return null;
  }

  return (MAD_TO_SIGMA * (value - baseline.median)) / baseline.mad;
}

export function meanOf(points: MetricPoint[]): number | null {
  const values = points.map((point) => point.value).filter((value) => Number.isFinite(value));

  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
