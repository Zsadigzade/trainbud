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
  | "load_ratio_low"
  | "recovery_strain";

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
  "recovery_strain",
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
  /**
   * The same measurement in at most 14 characters, for the watch glance.
   *
   * The glance is a handful of characters wide and elided the headline to
   * "This week's traini..." -- the part that said what changed was the part
   * that got cut. Written here, by the code that knows which number matters.
   */
  short: string;
  /**
   * The rule this fired on, with the numbers in force -- at most 160 characters.
   *
   * "Transparency about metrics is helpful" was the reply that mattered in the
   * first thread anyone left on this project. A finding that states a
   * measurement and hides the bar it cleared is the same black box as the score
   * it was built to get around, so every finding carries its own rule, and
   * that rule reads from the user's profile rather than from a constant.
   */
  why: string;
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
  /**
   * The bars every detector clears before it says anything. Omitted means the
   * shipping defaults; buildDetectorInput always passes the user's own, and a
   * test holds it to that.
   */
  rules?: DetectorRules;
}

/**
 * Where each detector draws its line, editable from the dashboard.
 *
 * These were constants in detectors.ts. The defaults below are exactly those
 * constants, so nobody's findings change on upgrade until they choose to move a
 * bar -- and the validation in profile.ts keeps a bar from being moved somewhere
 * that makes every day, or no day, a finding.
 */
export interface DetectorRules {
  /** A run of `days` days, each at least `minBpm` and `minZ` deviations above the median. */
  restingHr: { days: number; minZ: number; minBpm: number };
  /** Hours of shortfall over seven nights, measured below the user's own floor. */
  sleepDebt: { hours: number };
  /** Deviations below the median the recent nights' median has to fall. Positive. */
  hrv: { dropZ: number };
  /** Acute:chronic TRIMP ratio above `high` or below `low`. */
  load: { high: number; low: number };
  /** Resting HR, overnight HRV and sleep stress all `z` deviations the wrong way for `days` days. */
  strain: { enabled: boolean; days: number; z: number };
}

export const DEFAULT_DETECTOR_RULES: DetectorRules = {
  restingHr: { days: 3, minZ: 2, minBpm: 3 },
  sleepDebt: { hours: 3 },
  hrv: { dropZ: 2 },
  load: { high: 1.5, low: 0.8 },
  strain: { enabled: true, days: 2, z: 1.5 },
};
