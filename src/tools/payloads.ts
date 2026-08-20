import type { DailyStressSummary, Vo2MaxEntry } from "../garmin/rawApi.js";
import type { ContextEntry, SubjectivePoint } from "../history/context.js";
import type { SubjectiveKind } from "../history/schema.js";
import type { Finding } from "../detect/findings.js";
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

export interface SleepPayload {
  requestedNights: number;
  recordedNights: number;
  averageScore: number | null;
  nights: SleepNightSummary[];
}

export interface LatestActivityPayload {
  activity: ActivitySummary | null;
}

export interface ActivitiesRangePayload {
  startDate: string;
  endDate: string;
  truncated: boolean;
  activities: ActivitySummary[];
}

export interface HeartRatePayload {
  requestedDays: number;
  recordedDays: number;
  currentResting: number | null;
  averageResting: number | null;
  trend: string;
  days: HeartRateDaySummary[];
}

export interface StressPayload {
  requestedDays: number;
  recordedDays: number;
  averageStress: number | null;
  trend: string;
  days: DailyStressSummary[];
}

export interface Vo2MaxPayload {
  requestedDays: number;
  recordedDays: number;
  current: number | null;
  oldest: number | null;
  trend: string;
  entries: Vo2MaxEntry[];
}

export interface RecoveryPayload {
  date: string;
  recovery: RecoveryStatusResult;
}

export interface BodyCompositionPayload {
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

export interface FindingsPayload {
  findings: Finding[];
  coverage: { days: number; ready: boolean };
}
