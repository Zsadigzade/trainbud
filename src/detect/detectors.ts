import { buildBaseline, meanOf, median, robustZ, type Baseline } from "./baseline.js";
import type { DetectorInput, Finding } from "./findings.js";
import type { MetricPoint } from "../history/store.js";

// SECTION: Detectors
//
// One function per signal, each pure, each returning a Finding or null. Nothing
// here calls a model: a language model asked to spot a trend will phrase a
// hallucinated one exactly as confidently as a real one, and this project's
// entire bug history is numbers being silently wrong. Code decides; the model
// only ever phrases what code decided.

const BASELINE_DAYS = 28;
const RECENT_DAYS = 3;
const SLEEP_WEEK_DAYS = 7;

/** Robust-z at which a run of days stops looking like night-to-night noise. */
const ELEVATION_Z = 2;

/**
 * A statistically large move can still be physiologically meaningless. Without
 * this floor, a very consistent sleeper gets flagged over 1 bpm.
 */
const ELEVATION_MIN_BPM = 3;

const SLEEP_DEBT_HOURS = 3;
const HRV_DROP_Z = -2;

interface Split {
  baselinePoints: MetricPoint[];
  recentPoints: MetricPoint[];
}

/**
 * The recent window is held out of the baseline. Left in, a three-day
 * elevation lifts the very median it is being measured against, and the longer
 * something persists the more normal it looks -- which is backwards.
 */
function split(points: MetricPoint[], recentDays: number): Split {
  if (points.length <= recentDays) {
    return { baselinePoints: [], recentPoints: points };
  }

  return {
    baselinePoints: points.slice(0, points.length - recentDays),
    recentPoints: points.slice(points.length - recentDays),
  };
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function lastDate(points: MetricPoint[], fallback: string): string {
  return points.at(-1)?.date ?? fallback;
}

export function detectRestingHrElevation(input: DetectorInput): Finding | null {
  const points = input.series("resting_hr", BASELINE_DAYS + RECENT_DAYS);
  const { baselinePoints, recentPoints } = split(points, RECENT_DAYS);

  if (recentPoints.length < RECENT_DAYS) {
    return null;
  }

  const baseline = buildBaseline(baselinePoints);
  if (!baseline) {
    return null;
  }

  // Every one of the recent days must clear both bars. A single normal morning
  // inside the run means it is not a run.
  const elevated = recentPoints.every((point) => {
    const z = robustZ(point.value, baseline);
    return z !== null && z >= ELEVATION_Z && point.value - baseline.median >= ELEVATION_MIN_BPM;
  });

  if (!elevated) {
    return null;
  }

  const recentMean = meanOf(recentPoints);
  if (recentMean === null) {
    return null;
  }

  const deltaBpm = round(recentMean - baseline.median);

  return {
    kind: "rhr_elevated",
    severity: deltaBpm >= 6 ? "warn" : "notice",
    date: lastDate(recentPoints, input.now.toISODate() ?? ""),
    headline: `Resting heart rate ${deltaBpm} bpm above your ${baseline.count}-day baseline, ${RECENT_DAYS} days running`,
    detail:
      "A run like this usually means the last few sessions have not been absorbed yet. Easy training or a rest day is the low-risk call until it settles.",
    values: {
      days: RECENT_DAYS,
      recentBpm: round(recentMean),
      baselineBpm: round(baseline.median),
      deltaBpm,
    },
  };
}

export function detectSleepDebt(input: DetectorInput): Finding | null {
  const points = input.series("sleep_seconds", BASELINE_DAYS + SLEEP_WEEK_DAYS);
  const { baselinePoints, recentPoints } = split(points, SLEEP_WEEK_DAYS);

  // A week with most of its nights missing is not a week with a deficit.
  if (recentPoints.length < 5) {
    return null;
  }

  const baseline = buildBaseline(baselinePoints);
  if (!baseline) {
    return null;
  }

  // Only shortfalls count. A long Saturday does not repay a short Tuesday --
  // netting them out is how a chronically short week reads as fine.
  const debtSeconds = recentPoints.reduce((total, point) => {
    return total + Math.max(0, baseline.median - point.value);
  }, 0);

  const debtHours = round(debtSeconds / 3600);
  if (debtHours < SLEEP_DEBT_HOURS) {
    return null;
  }

  return {
    kind: "sleep_debt",
    severity: debtHours >= 6 ? "warn" : "notice",
    date: lastDate(recentPoints, input.now.toISODate() ?? ""),
    headline: `${debtHours} h of sleep short of your usual ${round(baseline.median / 3600)} h over the last ${recentPoints.length} nights`,
    detail:
      "Short weeks blunt what hard sessions give back. Worth protecting the next few nights before the next quality session.",
    values: {
      debtHours,
      nights: recentPoints.length,
      baselineHours: round(baseline.median / 3600),
    },
  };
}

export function detectHrvTrendBreak(input: DetectorInput): Finding | null {
  const points = input.series("hrv_overnight", BASELINE_DAYS + RECENT_DAYS);
  const { baselinePoints, recentPoints } = split(points, RECENT_DAYS);

  if (recentPoints.length < RECENT_DAYS) {
    return null;
  }

  const baseline = buildBaseline(baselinePoints);
  if (!baseline) {
    return null;
  }

  // The median of the recent nights, not their mean. HRV is noisy enough that
  // one low reading says almost nothing, and a mean lets a single bad night
  // drag the window past the threshold on its own -- which is the very outlier
  // problem the baseline uses a median to avoid. With a median, two of the
  // three nights have to be low before this fires.
  const recentMedian = median(recentPoints.map((point) => point.value));
  if (recentMedian === null) {
    return null;
  }

  const z = robustZ(recentMedian, baseline);
  if (z === null || z > HRV_DROP_Z) {
    return null;
  }

  return buildHrvFinding(recentPoints, recentMedian, baseline, input);
}

function buildHrvFinding(
  recentPoints: MetricPoint[],
  recentMedian: number,
  baseline: Baseline,
  input: DetectorInput
): Finding {
  const dropPercent = round(((baseline.median - recentMedian) / baseline.median) * 100);

  return {
    kind: "hrv_trend_break",
    severity: dropPercent >= 20 ? "warn" : "notice",
    date: lastDate(recentPoints, input.now.toISODate() ?? ""),
    headline: `Overnight HRV ${dropPercent}% below your ${baseline.count}-day baseline across ${recentPoints.length} nights`,
    detail:
      "A multi-night drop is the usual sign that recovery is lagging the training. Keep the next session easy and see whether it comes back.",
    values: {
      nights: recentPoints.length,
      recentMedian: round(recentMedian),
      baseline: round(baseline.median),
      dropPercent,
    },
  };
}
