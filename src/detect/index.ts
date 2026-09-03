import { DateTime } from "luxon";
import type { MetricKind } from "../history/schema.js";
import { getActivitiesBetween, getMetricSeries } from "../history/store.js";
import {
  detectHrvTrendBreak,
  detectLoadRatio,
  detectRestingHrElevation,
  detectSleepDebt,
} from "./detectors.js";
import type { DetectorInput, Finding, FindingSeverity } from "./findings.js";

// SECTION: Running the detectors

/** Below this, the store describes a fortnight's mood rather than a person. */
const READY_DAYS = 14;

/**
 * How old the newest measurement may be before "nothing stands out" stops being
 * an answer.
 *
 * Coverage counted total days and ignored recency, so a store holding 74 days
 * that stopped three weeks ago reported `ready: true` and every detector then
 * correctly found nothing -- because there was nothing recent to find. The app
 * told the user, confidently, that nothing stood out. That is the exact failure
 * the cold-start guard exists to prevent: an absence rendered as a clean bill of
 * health. It just was not looking at the right absence.
 *
 * Three days of grace: Garmin finalises a sleep score hours after waking, and a
 * watch that has not been synced since yesterday is normal.
 */
const MAX_STALE_DAYS = 3;

/** Every metric a detector reads, for the coverage figure. */
const COVERAGE_KINDS: MetricKind[] = ["resting_hr", "sleep_seconds", "hrv_overnight"];

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  warn: 0,
  notice: 1,
  info: 2,
};

export interface Coverage {
  days: number;
  ready: boolean;
  /** Newest date with any measurement, or null for an empty store. */
  throughDate: string | null;
  /** Days between that and today. 0 when the record is current. */
  staleDays: number;
}

export interface DetectionResult {
  findings: Finding[];
  coverage: Coverage;
}

/**
 * Why `ready` is false, and the sentence to say about it.
 *
 * `ready` collapses two refusals that need opposite answers: COLD -- there is
 * not enough history yet, wait -- and STALE -- there is plenty and it stops
 * weeks ago, go and fetch. Each surface used to write that sentence itself, and
 * only one of the four was taught the difference when `staleDays` was added.
 * The three that were not printed the cold-start line at a 74-day store:
 *
 *     Still gathering data - 74 of the 14 days needed
 *
 * which is arithmetic nonsense, and worse, it is what a model repeats back to
 * the user as "I don't have access to your data" -- while 598 measurements sit
 * on disk. One description, read by every surface, is the only shape that stops
 * the next surface from inheriting the same fault.
 */
export type CoverageState = "ready" | "stale" | "cold";

export interface CoverageDescription {
  state: CoverageState;
  /** One sentence about the record itself. */
  detail: string;
  /** The single next action, or null when nothing needs doing. */
  fix: string | null;
}

export function describeFindingsCoverage(coverage: Coverage): CoverageDescription {
  if (coverage.ready) {
    return { state: "ready", detail: `${coverage.days} days of history`, fix: null };
  }

  // Depth is present and the record has simply stopped. Note this is tested
  // before the day count: a store can be both short and stale, and "go and
  // fetch" is the useful answer in that case too.
  if (coverage.throughDate !== null && coverage.staleDays > MAX_STALE_DAYS) {
    return {
      state: "stale",
      detail:
        `${coverage.days} days of history are stored, but the record stops at ` +
        `${coverage.throughDate} — ${coverage.staleDays} days ago. Nothing is known about the days since. ` +
        `The stored history is real and still worth reasoning about; what is missing is only the days after that date.`,
      fix: "Run `trainbud backfill --days 20` to bring the record up to date.",
    };
  }

  return {
    state: "cold",
    detail: `Still gathering data — ${coverage.days} of the ${READY_DAYS} days needed before anything can be compared against a baseline.`,
    fix: "Run `trainbud backfill` to pull what Garmin already holds.",
  };
}

/** The only function here that touches the store. */
export function buildDetectorInput(now: DateTime = DateTime.local()): DetectorInput {
  const startOfDay = now.startOf("day");

  return {
    now,
    series: (kind, days) => {
      const start = startOfDay.minus({ days }).toISODate() ?? "";
      const end = startOfDay.toISODate() ?? "";
      return getMetricSeries(kind, start, end);
    },
    activities: (days) => {
      const start = startOfDay.minus({ days }).toISODate() ?? "";
      const end = startOfDay.toISODate() ?? "";
      return getActivitiesBetween(start, end);
    },
  };
}

/**
 * Cold start is a first-class case, not an edge one. With no history every
 * detector correctly returns null, and an empty array on its own is
 * indistinguishable from a clean bill of health. `ready` is what lets a surface
 * say "still gathering data" instead of implying everything is fine -- so
 * surfaces read the flag, never the length of the array.
 */
export function runDetectors(input: DetectorInput = buildDetectorInput()): DetectionResult {
  const series = COVERAGE_KINDS.map((kind) => input.series(kind, 365));
  const days = Math.max(0, ...series.map((points) => points.length));

  // The newest measurement of any kind, and how old it is. A detector compares
  // a recent day against a baseline; with no recent day there is nothing to
  // compare, and saying "nothing stands out" would be a claim about a day that
  // was never recorded.
  const throughDate =
    series
      .map((points) => points.at(-1)?.date ?? null)
      .filter((date): date is string => date !== null)
      .sort()
      .at(-1) ?? null;

  const today = input.now.startOf("day");
  const staleDays =
    throughDate === null
      ? Number.MAX_SAFE_INTEGER
      : Math.max(0, Math.round(today.diff(DateTime.fromISO(throughDate).startOf("day"), "days").days));

  const findings = [
    detectRestingHrElevation(input),
    detectHrvTrendBreak(input),
    detectLoadRatio(input),
    detectSleepDebt(input),
  ].filter((finding): finding is Finding => finding !== null);

  // Severity first, then a fixed detector order via the kind. The watch shows
  // the first couple, and findings that shuffled between syncs would read as
  // the data having changed when it has not.
  findings.sort((left, right) => {
    const bySeverity = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
    return bySeverity !== 0 ? bySeverity : left.kind.localeCompare(right.kind);
  });

  return {
    findings,
    coverage: {
      days,
      ready: days >= READY_DAYS && staleDays <= MAX_STALE_DAYS,
      throughDate,
      staleDays: throughDate === null ? 0 : staleDays,
    },
  };
}
