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
  deepSleepSeconds: number;
  lightSleepSeconds: number;
  remSleepSeconds: number;
  awakeCount: number;
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
  components: {
    hrvScore: number;
    sleepScore: number;
    stressScore: number;
    restingHrScore: number;
  };
}

export interface ToolTextResult {
  type: "text";
  text: string;
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
