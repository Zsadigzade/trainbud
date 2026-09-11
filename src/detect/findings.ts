import type { DateTime } from "luxon";
import type { ContextEntry } from "../history/context.js";
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

/**
 * The same list at runtime, because a mute arrives as a string from an MCP
 * client, a dashboard form or a CLI flag, and every one of those has to be told
 * what the valid answers are before it can reject a wrong one.
 */
export const FINDING_KINDS: FindingKind[] = [
  "rhr_elevated",
  "sleep_debt",
  "hrv_trend_break",
  "load_ratio_high",
  "load_ratio_low",
];

/** `"*"` mutes every kind -- "I know why everything is off this week". */
export const MUTE_ALL = "*";

export type MuteTarget = FindingKind | typeof MUTE_ALL;

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
 * A finding the user has already accounted for, kept rather than dropped.
 *
 * Deleting it would make the app lie by omission: the measurement is still
 * true, and "nothing stands out" is a different sentence from "one thing stands
 * out and you told me why". Every surface that reports a quiet day has to be
 * able to tell those apart, which it cannot do from an array that silently got
 * shorter.
 */
export interface MutedFinding extends Finding {
  mutedBy: {
    id: number;
    kind: ContextEntry["kind"];
    text: string;
  };
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
  /**
   * Everything the user has ever told the app about themselves.
   *
   * Deliberately required rather than optional. The fault this exists to fix is
   * a consumer that had the context available and never read it; an optional
   * field would let the next consumer reintroduce it silently and still
   * typecheck. Unbounded on purpose -- these rows are hand-typed, and there are
   * dozens of them in a lifetime, not thousands.
   */
  context: () => ContextEntry[];
}
