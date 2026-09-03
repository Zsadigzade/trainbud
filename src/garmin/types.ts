import type { StoredSessionTokens } from "./garminApiTypes.js";

export type StoredSession = StoredSessionTokens;

export interface ActivitySummary {
  activityId: number;
  name: string;
  type: string;
  startTimeLocal: string;
  // Connect omits these for activities where they do not apply — strength
  // training reports no distance or pace, indoor rides no elevation. They were
  // typed as plain numbers, which type-checked while crashing at runtime on
  // `undefined.toFixed`.
  distanceMeters: number | null;
  durationSeconds: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  elevationGainMeters: number | null;
  calories: number | null;
  averageSpeedMps: number | null;
}

export interface SleepNightSummary {
  date: string;
  totalSleepSeconds: number;
  // Null when the night came from `daily_metric` rather than from an archived
  // Connect response — the store keeps the duration and the score forever and
  // the stage breakdown only for as long as the raw archive holds the day.
  // Typed as plain numbers, a thin night would have had to invent zeroes, and
  // "Deep: 0s" is a measurement claim about a night nobody measured that way.
  deepSleepSeconds: number | null;
  lightSleepSeconds: number | null;
  remSleepSeconds: number | null;
  awakeCount: number | null;
  sleepScore: number | null;
  avgSleepStress: number | null;
  avgOvernightHrv: number | null;
  hrvStatus: string | null;
}

export interface HeartRateDaySummary {
  date: string;
  restingHeartRate: number | null;
  maxHeartRate: number | null;
  minHeartRate: number | null;
  averageHeartRate: number | null;
}

export interface BodyCompositionEntry {
  date: string;
  weightKg: number | null;
  bodyFatPercent: number | null;
  muscleMassKg: number | null;
  bmi: number | null;
}

export interface RecoveryWeights {
  hrv: number;
  sleep: number;
  stress: number;
  restingHr: number;
}

export interface RecoveryStatusResult {
  score: number;
  status: "recovered" | "good" | "fatigued";
  recommendation: string;
  /**
   * Null means the signal was not measured, which is a different thing from
   * measuring badly. Sleep defaulted to 0 seconds when the watch was not worn
   * and scored 35 out of 100 for it, so an unworn night produced a confident
   * "fatigued" verdict out of no data at all. A null component is dropped and
   * the remaining weights are renormalised.
   */
  components: {
    hrvScore: number;
    sleepScore: number | null;
    stressScore: number;
    restingHrScore: number;
  };
}

export interface ToolTextResult {
  type: "text";
  text: string;
}

/**
 * Tools return rendered text for MCP clients and the same information as typed
 * data for everything else -- the history store, the detectors and the watch.
 * Before this existed, watchApi.ts recovered numbers by matching regexes
 * against the formatted prose, so a wording change in a renderer silently broke
 * the watch.
 */
export interface ToolResult<T> extends ToolTextResult {
  data: T;
}

export class GarminApiError extends Error {
  readonly statusCode?: number;
  readonly retryAfterSeconds?: number;

  constructor(message: string, statusCode?: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "GarminApiError";
    this.statusCode = statusCode;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
