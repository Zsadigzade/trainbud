import type { DateTime } from "luxon";
import type { MetricKind } from "../history/schema.js";
import type { MetricPoint, StoredActivity } from "../history/store.js";

// SECTION: Findings
//
// A finding states a measurement and the baseline it is compared against. It
// never states a cause. "Resting heart rate 4 bpm above your 28-day baseline
// for 3 days" -- not "you may be getting sick", because the data cannot tell an
// infection from a warm bedroom, a late meal or a glass of wine, and the
// distinction between reporting and diagnosing is what keeps this a training
// tool rather than a symptom checker.
//
// Advice attached to a finding covers training load and nothing else.

export type FindingKind =
  | "rhr_elevated"
  | "sleep_debt"
  | "hrv_trend_break"
  | "load_ratio_high"
  | "load_ratio_low";

export type FindingSeverity = "info" | "notice" | "warn";

export interface Finding {
  kind: FindingKind;
  severity: FindingSeverity;
  /** The day the finding is about, which is the most recent day it covers. */
  date: string;
  /** The measurement, in plain language. Never a cause. */
  headline: string;
  /** What it means for training. Never medical. */
  detail: string;
  /** The numbers behind the headline, for a surface that wants to render them. */
  values: Record<string, number>;
}

/**
 * Detectors read through this rather than reaching for the store, which is what
 * keeps every one of them a pure function over arrays and their tests free of a
 * database.
 */
export interface DetectorInput {
  now: DateTime;
  /** Points for the last `days` days, oldest first. */
  series: (kind: MetricKind, days: number) => MetricPoint[];
  activities: (days: number) => StoredActivity[];
}
