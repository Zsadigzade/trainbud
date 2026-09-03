import type { DailyStressSummary, Vo2MaxEntry } from "../garmin/rawApi.js";
import type { ContextEntry, SubjectivePoint } from "../history/context.js";
import type { SubjectiveKind } from "../history/schema.js";
import type { Finding } from "../detect/findings.js";
import type { Coverage } from "../detect/index.js";
import type {
  ActivitySummary,
  BodyCompositionEntry,
  HeartRateDaySummary,
  RecoveryStatusResult,
  SleepNightSummary,
} from "../garmin/types.js";

// SECTION: Structured tool payloads
//
// One interface per tool, named after the tool. These are the shapes the
// history store, the detectors and the watch read. Nothing here is derived from
// formatted text: every field comes straight from a mapper over a Garmin
// response, so a change to how a tool prints itself cannot change what its
// consumers see.

/**
 * Where an answer came from.
 *
 * Additive on purpose: the watch parses this JSON on the device and ignores
 * fields it does not know, so a build already on someone's wrist keeps working
 * unchanged. What these let every other reader do is tell a measurement fetched
 * from Connect a moment ago from one read out of TrainBud's own store because
 * Connect would not answer -- two facts that used to render identically, and
 * one of which used to render as "no data" instead.
 */
export interface StoredProvenance {
  /** Days in this answer that came from the local store, not from Garmin. */
  storedDays: number;
  /** Newest date the stored part covers. Null when nothing came from the store. */
  storedThrough: string | null;
  /**
   * True when the days returned are not the days asked about, because the
   * record stops before the requested window and the window was moved back to
   * where the data is. Every renderer must say so; presenting a fortnight-old
   * week as this week is worse than the empty answer it replaces.
   */
  storedWindowMoved: boolean;
}

export interface SleepPayload {
  requestedNights: number;
  recordedNights: number;
  /**
   * Nights whose request FAILED. `recordedNights === 0` with this at zero means
   * the user has no sleep recorded; with this above zero it means Garmin would
   * not answer, and the two must never render the same sentence.
   */
  unreachableNights: number;
  averageScore: number | null;
  nights: SleepNightSummary[];
  /** Nights that came from the local store rather than from Garmin. */
  storedNights: number;
  storedThrough: string | null;
  storedWindowMoved: boolean;
}

export interface LatestActivityPayload {
  activity: ActivitySummary | null;
  /** True when Garmin could not be reached and this came out of the store. */
  fromStore: boolean;
}

export interface ActivitiesRangePayload {
  startDate: string;
  endDate: string;
  truncated: boolean;
  activities: ActivitySummary[];
  /** True when Garmin could not be reached and these came out of the store. */
  fromStore: boolean;
}

export interface HeartRatePayload extends StoredProvenance {
  requestedDays: number;
  recordedDays: number;
  /** Days whose request failed, as opposed to days with nothing measured. */
  unreachableDays: number;
  currentResting: number | null;
  averageResting: number | null;
  trend: string;
  days: HeartRateDaySummary[];
}

export interface StressPayload extends StoredProvenance {
  requestedDays: number;
  recordedDays: number;
  /** Days whose request failed, as opposed to days with nothing measured. */
  unreachableDays: number;
  averageStress: number | null;
  trend: string;
  days: DailyStressSummary[];
}

export interface Vo2MaxPayload extends StoredProvenance {
  requestedDays: number;
  recordedDays: number;
  /** Days whose request failed, as opposed to days with nothing measured. */
  unreachableDays: number;
  current: number | null;
  oldest: number | null;
  trend: string;
  entries: Vo2MaxEntry[];
}

export interface RecoveryPayload {
  date: string;
  recovery: RecoveryStatusResult;
  /**
   * The date the signals behind this score were measured, when they came from
   * the store rather than from a live call. A recovery score is a claim about
   * today; built from a fortnight-old night it is a claim about a fortnight ago,
   * and the difference has to be sayable.
   */
  storedThrough: string | null;
}

export interface BodyCompositionPayload extends StoredProvenance {
  requestedDays: number;
  recordedDays: number;
  current: BodyCompositionEntry | null;
  baseline: BodyCompositionEntry | null;
  weightDeltaKg: number | null;
  bodyFatDeltaPercent: number | null;
  weightTrend: string;
  bodyFatTrend: string;
  muscleTrend: string;
  entries: BodyCompositionEntry[];
}

export interface TrainingInsightsPayload {
  startDate: string;
  endDate: string;
  latest: ActivitySummary | null;
  activities: ActivitySummary[];
  sleep: SleepPayload | null;
  recovery: RecoveryPayload | null;
  stress: StressPayload | null;
}

export interface RememberContextPayload {
  entry: ContextEntry;
}

export interface ContextListPayload {
  onDate: string;
  includeClosed: boolean;
  entries: ContextEntry[];
}

export interface SubjectivePayload {
  date: string;
  kind: SubjectiveKind;
  value: number;
  note: string | null;
  recent: SubjectivePoint[];
}

/**
 * The whole coverage object, not a two-field subset of it.
 *
 * This was typed `{ days, ready }` while the value assigned to it carried
 * `throughDate` and `staleDays` as well. The renderer therefore could not see
 * the two fields that distinguish "not enough history yet" from "plenty, and it
 * stops on 2026-08-21" -- so it printed the cold-start sentence at a 74-day
 * store. A type narrower than its value does not describe data, it hides it.
 */
export interface FindingsPayload {
  findings: Finding[];
  coverage: Coverage;
}
