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

/** Every metric a detector reads, for the coverage figure. */
const COVERAGE_KINDS: MetricKind[] = ["resting_hr", "sleep_seconds", "hrv_overnight"];

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  warn: 0,
  notice: 1,
  info: 2,
};

export interface DetectionResult {
  findings: Finding[];
  coverage: {
    days: number;
    ready: boolean;
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
  const days = Math.max(
    0,
    ...COVERAGE_KINDS.map((kind) => input.series(kind, 365).length)
  );

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
      ready: days >= READY_DAYS,
    },
  };
}
