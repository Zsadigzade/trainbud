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

/**
 * What the pool held, for the case where nothing was comparable.
 *
 * Measured on real history: of 28 activities, 14 had no comparable workout --
 * and 8 of those 14 did have earlier workouts of the same sport, at distances
 * outside the tolerance. One had eleven. Telling that person "this is the first
 * one that qualifies" is false in the way that matters to them.
 */
export interface ComparisonContext {
  /** Earlier workouts of the same sport, counted before the scale filter. */
  earlierSameType?: number;
  /** The nearest of those by scale, whether or not it was close enough. */
  nearest?: StoredActivity | null;
}

export interface WorkoutComparison {
  subject: StoredActivity;
  closest: StoredActivity | null;
  comparableCount: number;
  earlierSameType: number;
  nearest: StoredActivity | null;
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
  comparables: StoredActivity[],
  context: ComparisonContext = {}
): WorkoutComparison {
  const closest = comparables[0] ?? null;

  return {
    subject,
    closest,
    comparableCount: comparables.length,
    earlierSameType: context.earlierSameType ?? comparables.length,
    nearest: context.nearest ?? closest,
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

function formatPace(secondsPerKm: number, units: Units): string {
  if (units === "imperial") {
    return `${formatDurationSeconds(secondsPerKm * (METRES_PER_MILE / 1000))}/mi`;
  }
  return `${formatDurationSeconds(secondsPerKm)}/km`;
}

/** The dimension a sport is measured in, said out loud. */
function describeScale(activity: StoredActivity, units: Units): string {
  if (typeof activity.distanceMeters === "number" && activity.distanceMeters > 0) {
    return units === "imperial"
      ? `${(activity.distanceMeters / METRES_PER_MILE).toFixed(2)} mi`
      : `${(activity.distanceMeters / 1000).toFixed(1)} km`;
  }
  if (typeof activity.durationSeconds === "number" && activity.durationSeconds > 0) {
    return formatDurationSeconds(activity.durationSeconds);
  }
  return "unmeasured";
}

function formatElevation(metres: number, units: Units): string {
  if (units === "imperial") {
    return `${Math.round(metres * FEET_PER_METRE)} ft`;
  }
  return `${Math.round(metres)} m`;
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

  // Both endpoints are rounded for display, so the difference has to come from
  // the rounded pair -- otherwise a line reads "24 m vs 38 m — 15 m lower" and
  // the three numbers on it disagree. Conversion to imperial happens inside the
  // formatter and is linear, so a delta taken in the native unit stays consistent
  // with the endpoints after conversion.
  const shownDelta = Math.abs(Math.round(metric.current) - Math.round(metric.reference));
  const change =
    metric.direction === "same" || shownDelta === 0
      ? "the same"
      : `${format(shownDelta)} ${metric.direction}`;
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

export type Units = "metric" | "imperial";

const METRES_PER_MILE = 1609.344;
const FEET_PER_METRE = 3.28084;

export function renderWorkoutComparison(
  comparison: WorkoutComparison,
  units: Units = "metric"
): string {
  const { subject, closest } = comparison;

  if (!closest) {
    const { earlierSameType, nearest } = comparison;

    // Having no earlier workout of this sport and having nine of them at other
    // distances are different answers, and only one of them is "your first".
    if (earlierSameType > 0 && nearest) {
      const plural = earlierSameType === 1 ? "workout" : "workouts";
      return [
        `${subject.name} on ${subject.date}: nothing close enough to compare with.`,
        "",
        `You have ${earlierSameType} earlier ${subject.type} ${plural} on record, but ` +
          `none within 20% of this one's ${describeScale(subject, units)}. The nearest ` +
          `is ${describeScale(nearest, units)} on ${nearest.date}.`,
        "",
        "Comparing efforts of very different lengths would say more about the",
        "distance than about you, so it is left alone.",
      ].join("\n");
    }

    return [
      `${subject.name} on ${subject.date}: no comparable workout in your history yet.`,
      "",
      `This is the first ${subject.type} workout on record, so there is nothing to`,
      "measure it against — which is not the same as saying it went badly.",
    ].join("\n");
  }

  const plural = comparison.comparableCount === 1 ? "workout" : "workouts";

  return [
    `${subject.name} on ${subject.date}, compared with ${describeWhen(closest, subject)} ` +
      `(${comparison.comparableCount} comparable ${plural} found):`,
    "",
    line("Duration", comparison.metrics.duration, formatDurationSeconds),
    line("Pace", comparison.metrics.pace, (value) => formatPace(value, units)),
    line("Avg HR", comparison.metrics.avgHr, (value) => `${Math.round(value)} bpm`),
    line("Max HR", comparison.metrics.maxHr, (value) => `${Math.round(value)} bpm`),
    line("Elevation", comparison.metrics.elevationGain, (value) => formatElevation(value, units)),
    line("Calories", comparison.metrics.calories, (value) => `${Math.round(value)}`),
  ].join("\n");
}
