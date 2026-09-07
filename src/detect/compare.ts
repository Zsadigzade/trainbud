import type { StoredActivity } from "../history/store.js";

/**
 * Comparing a workout against the ones like it.
 *
 * Two rules shape everything here, and both come from mistakes this codebase
 * has already paid for:
 *
 *   * A measurement that is missing is `unknown`, never zero. A run whose
 *     heart-rate strap dropped out is not a run 150 bpm below the last one, and
 *     a comparison with nothing to compare against has to say so rather than
 *     quietly treating an empty set as a baseline.
 *   * The comparison is arithmetic, computed here. A model may phrase the
 *     result; it does not decide whether you were faster.
 */

/** How far apart two workouts may be and still count as the same effort. */
const SIMILARITY_TOLERANCE = 0.2;

/** Below this many comparable workouts, "typical" is not a number worth saying. */
const MIN_SAMPLES_FOR_TYPICAL = 3;

const DEFAULT_LIMIT = 5;

export type MetricState = "known" | "unknown";

export type MetricDirection = "higher" | "lower" | "same" | "faster" | "slower" | "unknown";

export interface MetricComparison {
  state: MetricState;
  current: number | null;
  reference: number | null;
  delta: number | null;
  direction: MetricDirection;
  /** Median across the comparable set, or null when there are too few of them. */
  typical: number | null;
}

export interface WorkoutComparison {
  subject: StoredActivity;
  closest: StoredActivity | null;
  comparableCount: number;
  metrics: {
    duration: MetricComparison;
    pace: MetricComparison;
    avgHr: MetricComparison;
    maxHr: MetricComparison;
    elevationGain: MetricComparison;
    calories: MetricComparison;
  };
}

function isPositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Seconds per kilometre, which only means anything when both parts are real. */
export function paceSecondsPerKm(activity: StoredActivity): number | null {
  if (!isPositive(activity.distanceMeters) || !isPositive(activity.durationSeconds)) {
    return null;
  }
  return Math.round(activity.durationSeconds / (activity.distanceMeters / 1000));
}

/** The dimension a sport is measured in: distance, or time when it records none. */
function scaleOf(activity: StoredActivity): { value: number; kind: "distance" | "duration" } | null {
  if (isPositive(activity.distanceMeters)) {
    return { value: activity.distanceMeters, kind: "distance" };
  }
  if (isPositive(activity.durationSeconds)) {
    return { value: activity.durationSeconds, kind: "duration" };
  }
  return null;
}

function startedEarlier(candidate: StoredActivity, subject: StoredActivity): boolean {
  if (candidate.date !== subject.date) {
    return candidate.date < subject.date;
  }
  return candidate.startTimeLocal < subject.startTimeLocal;
}

/**
 * Earlier workouts of the same sport, at a comparable scale, closest first.
 *
 * "Closest" is by scale rather than by date on purpose: a 5k from March is a
 * better comparison for today's 5k than yesterday's 400 m shakeout, and the
 * question this answers is "how did that go, compared with when I do that".
 */
export function findComparableWorkouts(
  subject: StoredActivity,
  pool: StoredActivity[],
  limit: number = DEFAULT_LIMIT
): StoredActivity[] {
  const subjectScale = scaleOf(subject);

  const comparable = pool.filter((candidate) => {
    if (candidate.activityId === subject.activityId) {
      return false;
    }
    if (candidate.type !== subject.type) {
      return false;
    }
    if (!startedEarlier(candidate, subject)) {
      return false;
    }
    if (!subjectScale) {
      return true;
    }

    const candidateScale = scaleOf(candidate);
    if (!candidateScale || candidateScale.kind !== subjectScale.kind) {
      return false;
    }

    const ratio = Math.abs(candidateScale.value - subjectScale.value) / subjectScale.value;
    return ratio <= SIMILARITY_TOLERANCE;
  });

  return comparable
    .sort((left, right) => {
      if (subjectScale) {
        const leftScale = scaleOf(left)?.value ?? Number.POSITIVE_INFINITY;
        const rightScale = scaleOf(right)?.value ?? Number.POSITIVE_INFINITY;
        const byCloseness =
          Math.abs(leftScale - subjectScale.value) - Math.abs(rightScale - subjectScale.value);
        if (byCloseness !== 0) {
          return byCloseness;
        }
      }
      // Same closeness: the more recent one is the more useful comparison.
      return right.startTimeLocal.localeCompare(left.startTimeLocal);
    })
    .slice(0, limit);
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function compareMetric(
  current: number | null,
  reference: number | null,
  samples: (number | null)[],
  lowerIs: "faster" | "lower"
): MetricComparison {
  const known = samples.filter((value): value is number => typeof value === "number");
  const typical = known.length >= MIN_SAMPLES_FOR_TYPICAL ? median(known) : null;

  if (typeof current !== "number" || typeof reference !== "number") {
    return { state: "unknown", current, reference, delta: null, direction: "unknown", typical };
  }

  const delta = Math.round((current - reference) * 100) / 100;
  const higher = lowerIs === "faster" ? "slower" : "higher";
  const lower = lowerIs === "faster" ? "faster" : "lower";

  return {
    state: "known",
    current,
    reference,
    delta,
    direction: delta === 0 ? "same" : delta < 0 ? lower : higher,
    typical,
  };
}

export function compareWorkouts(
  subject: StoredActivity,
  comparables: StoredActivity[]
): WorkoutComparison {
  const closest = comparables[0] ?? null;

  return {
    subject,
    closest,
    comparableCount: comparables.length,
    metrics: {
      duration: compareMetric(
        subject.durationSeconds,
        closest?.durationSeconds ?? null,
        comparables.map((activity) => activity.durationSeconds),
        "lower"
      ),
      pace: compareMetric(
        paceSecondsPerKm(subject),
        closest ? paceSecondsPerKm(closest) : null,
        comparables.map((activity) => paceSecondsPerKm(activity)),
        "faster"
      ),
      avgHr: compareMetric(
        subject.avgHr,
        closest?.avgHr ?? null,
        comparables.map((activity) => activity.avgHr),
        "lower"
      ),
      maxHr: compareMetric(
        subject.maxHr,
        closest?.maxHr ?? null,
        comparables.map((activity) => activity.maxHr),
        "lower"
      ),
      elevationGain: compareMetric(
        subject.elevationGainMeters,
        closest?.elevationGainMeters ?? null,
        comparables.map((activity) => activity.elevationGainMeters),
        "lower"
      ),
      calories: compareMetric(
        subject.calories,
        closest?.calories ?? null,
        comparables.map((activity) => activity.calories),
        "lower"
      ),
    },
  };
}

function formatDurationSeconds(seconds: number): string {
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

function formatPace(secondsPerKm: number): string {
  return `${formatDurationSeconds(secondsPerKm)}/km`;
}

function line(label: string, metric: MetricComparison, format: (value: number) => string): string {
  if (metric.state === "unknown" || metric.current === null || metric.reference === null) {
    const missing =
      metric.current === null && metric.reference === null
        ? "neither workout recorded it"
        : metric.current === null
          ? "this one did not record it"
          : "the earlier one did not record it";
    return `  ${label}: unknown — ${missing}`;
  }

  const change =
    metric.direction === "same"
      ? "the same"
      : `${format(Math.abs(metric.delta ?? 0))} ${metric.direction}`;
  const typical = metric.typical === null ? "" : ` (typical ${format(metric.typical)})`;

  return `  ${label}: ${format(metric.current)} vs ${format(metric.reference)} — ${change}${typical}`;
}

/**
 * How to name the workout being compared against.
 *
 * A date alone is ambiguous when both happened on the same day, which is the
 * normal shape of treadmill intervals: three efforts, one date, and "compared
 * with 2026-09-07" tells you nothing about which one.
 */
function describeWhen(closest: StoredActivity, subject: StoredActivity): string {
  if (closest.date !== subject.date) {
    return closest.date;
  }
  const time = closest.startTimeLocal.split(" ")[1]?.slice(0, 5);
  return time ? `${closest.date} at ${time}` : closest.date;
}

export function renderWorkoutComparison(comparison: WorkoutComparison): string {
  const { subject, closest } = comparison;

  if (!closest) {
    return [
      `${subject.name} on ${subject.date}: no comparable workout in your history yet.`,
      "",
      "A comparison needs an earlier workout of the same type at a similar",
      "distance, or a similar duration for a sport that records no distance.",
      "This is the first one that qualifies, so there is nothing to measure it",
      "against — which is not the same as saying it went badly.",
    ].join("\n");
  }

  const plural = comparison.comparableCount === 1 ? "workout" : "workouts";

  return [
    `${subject.name} on ${subject.date}, compared with ${describeWhen(closest, subject)} ` +
      `(${comparison.comparableCount} comparable ${plural} found):`,
    "",
    line("Duration", comparison.metrics.duration, formatDurationSeconds),
    line("Pace", comparison.metrics.pace, formatPace),
    line("Avg HR", comparison.metrics.avgHr, (value) => `${Math.round(value)} bpm`),
    line("Max HR", comparison.metrics.maxHr, (value) => `${Math.round(value)} bpm`),
    line("Elevation", comparison.metrics.elevationGain, (value) => `${Math.round(value)} m`),
    line("Calories", comparison.metrics.calories, (value) => `${Math.round(value)}`),
  ].join("\n");
}
