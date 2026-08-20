import { executeTool } from "./tools/index.js";
import { generateDailyInsight } from "./promptApi.js";
import { DateTime } from "luxon";
import { runDetectors } from "./detect/index.js";
import { buildPromptSuggestions } from "./promptSuggestions.js";
import { activeContext, type ContextEntry } from "./history/context.js";
import type { Finding } from "./detect/findings.js";
import type { RecoveryStatusResult } from "./garmin/types.js";
import type {
  HeartRatePayload,
  LatestActivityPayload,
  RecoveryPayload,
  SleepPayload,
  StressPayload,
  Vo2MaxPayload,
} from "./tools/payloads.js";

// SECTION: Watch API
//
// The watch reads this JSON and nothing else, so the shapes below are a
// contract with a build that is already on someone's wrist: fields may be
// added, never renamed or removed.
//
// These used to be reconstructed by matching regexes against the prose each
// tool printed -- `Recovery score:\s*(null|\d+)\/100`, `(\d+)h`, `resting \d+
// bpm, max (\d+) bpm`. That made every renderer's wording load-bearing for the
// watch while looking like formatting, and none of it was covered by a test.
// The tools now return typed payloads and these are plain mappers over them.

export interface WatchRecovery {
  score: number;
  label: string;
}

export interface WatchSleep {
  hours: number;
  score: number | null;
  label: string;
}

export interface WatchActivity {
  name: string;
  distance_km: number | null;
  duration_min: number | null;
  avg_hr: number | null;
  date: string;
}

export interface WatchHeartRate {
  resting: number;
  max: number | null;
}

export interface WatchDailyOverview {
  recovery: number | null;
  sleep_h: number | null;
  stress: number | null;
  vo2max: number | null;
}

export interface WatchStress {
  avg: number;
  label: string;
}

export interface WatchVo2Max {
  value: number;
  trend: string;
}

/**
 * The watch gets the sentence, not the numbers to build one. It cannot wrap
 * arbitrary text well -- a fixed-font activity name already clips on a 390 px
 * round screen -- so the detail paragraph and the raw values stay on the server.
 */
export interface WatchFinding {
  kind: string;
  severity: string;
  headline: string;
}

export interface WatchCoverage {
  days: number;
  ready: boolean;
}

export interface WatchSummary {
  daily_overview: WatchDailyOverview;
  recovery: WatchRecovery | null;
  sleep: WatchSleep | null;
  activity: WatchActivity | null;
  stress: WatchStress | null;
  vo2max: WatchVo2Max | null;
  heart_rate: WatchHeartRate | null;
  findings: WatchFinding[];
  coverage: WatchCoverage;
  /**
   * The five Ask prompts for today. The watch reads these instead of the
   * hardcoded strings in strings.xml, so the menu asks about what actually
   * happened rather than the same five questions every day.
   */
  prompts: string[];
  ai_insight: string | null;
  updated_at: string;
}

// SECTION: Payload to card mappers

const RECOVERY_LABELS: Record<RecoveryStatusResult["status"], string> = {
  recovered: "Ready",
  good: "Light",
  fatigued: "Rest",
};

export function toWatchRecovery(payload: RecoveryPayload | null): WatchRecovery | null {
  if (!payload) {
    return null;
  }

  return {
    score: payload.recovery.score,
    label: RECOVERY_LABELS[payload.recovery.status],
  };
}

export function toWatchSleep(payload: SleepPayload | null): WatchSleep | null {
  const night = payload?.nights[0];
  if (!payload || !night) {
    return null;
  }

  const score = night.sleepScore ?? payload.averageScore;

  let label = "Fair";
  if (score !== null && score >= 80) {
    label = "Great";
  } else if (score !== null && score >= 60) {
    label = "Good";
  } else if (score !== null && score > 0) {
    label = "Poor";
  }

  return {
    hours: Math.round((night.totalSleepSeconds / 3600) * 10) / 10,
    score,
    label,
  };
}

export function toWatchActivity(payload: LatestActivityPayload | null): WatchActivity | null {
  const activity = payload?.activity;
  if (!activity) {
    return null;
  }

  return {
    name: activity.name,
    distance_km:
      activity.distanceMeters === null
        ? null
        : Math.round((activity.distanceMeters / 1000) * 100) / 100,
    duration_min:
      activity.durationSeconds === null ? null : Math.round(activity.durationSeconds / 60),
    avg_hr: activity.averageHeartRate,
    date: activity.startTimeLocal,
  };
}

function stressLabel(avg: number): string {
  if (avg <= 25) {
    return "Low";
  }
  if (avg <= 50) {
    return "Medium";
  }
  return "High";
}

export function toWatchStress(payload: StressPayload | null): WatchStress | null {
  if (!payload || payload.averageStress === null) {
    return null;
  }

  return { avg: payload.averageStress, label: stressLabel(payload.averageStress) };
}

export function toWatchVo2Max(payload: Vo2MaxPayload | null): WatchVo2Max | null {
  if (!payload || payload.current === null) {
    return null;
  }

  return { value: Math.round(payload.current * 10) / 10, trend: payload.trend };
}

export function toWatchHeartRate(payload: HeartRatePayload | null): WatchHeartRate | null {
  if (!payload || payload.currentResting === null) {
    return null;
  }

  return { resting: payload.currentResting, max: payload.days[0]?.maxHeartRate ?? null };
}

// SECTION: Summary assembly

export function toWatchFindings(findings: Finding[]): WatchFinding[] {
  return findings.map((finding) => ({
    kind: finding.kind,
    severity: finding.severity,
    headline: finding.headline,
  }));
}

export interface WatchSummaryParts {
  recovery: RecoveryPayload | null;
  sleep: SleepPayload | null;
  activity: LatestActivityPayload | null;
  stress: StressPayload | null;
  vo2max: Vo2MaxPayload | null;
  heartRate: HeartRatePayload | null;
  findings: Finding[];
  coverage: WatchCoverage;
  context: ContextEntry[];
  updatedAt: string;
}

export function buildWatchSummaryFrom(
  parts: WatchSummaryParts
): Omit<WatchSummary, "ai_insight"> {
  const recovery = toWatchRecovery(parts.recovery);
  const sleep = toWatchSleep(parts.sleep);
  const stress = toWatchStress(parts.stress);
  const vo2max = toWatchVo2Max(parts.vo2max);

  return {
    daily_overview: {
      recovery: recovery?.score ?? null,
      sleep_h: sleep?.hours ?? null,
      stress: stress?.avg ?? null,
      vo2max: vo2max?.value ?? null,
    },
    recovery,
    sleep,
    activity: toWatchActivity(parts.activity),
    stress,
    vo2max,
    heart_rate: toWatchHeartRate(parts.heartRate),
    findings: toWatchFindings(parts.findings),
    coverage: parts.coverage,
    prompts: buildPromptSuggestions(
      { findings: parts.findings, coverage: parts.coverage },
      parts.context
    ),
    updated_at: parts.updatedAt,
  };
}

/**
 * One failing tool must not empty the whole screen -- the watch renders each
 * card independently and shows "No data" for the ones that are missing.
 */
async function payloadOf<T>(name: string, args: Record<string, unknown>): Promise<T | null> {
  try {
    const result = await executeTool(name, args);
    return (result.data as T) ?? null;
  } catch {
    return null;
  }
}

export async function buildWatchSummary(): Promise<WatchSummary> {
  // Detection is a local SQLite read, so it costs nothing next to six Garmin
  // round trips and does not need to be raced with them.
  const detection = runDetectors();

  const [recovery, sleep, activity, stress, vo2max, heartRate] = await Promise.all([
    payloadOf<RecoveryPayload>("get_recovery_status", {}),
    payloadOf<SleepPayload>("get_sleep_data", { nights: 1 }),
    payloadOf<LatestActivityPayload>("get_latest_activity", {}),
    payloadOf<StressPayload>("get_stress_levels", { days: 7 }),
    payloadOf<Vo2MaxPayload>("get_vo2_max_trends", { days: 30 }),
    payloadOf<HeartRatePayload>("get_heart_rate_trends", { days: 7 }),
  ]);

  const summary: WatchSummary = {
    ...buildWatchSummaryFrom({
      recovery,
      sleep,
      activity,
      stress,
      vo2max,
      heartRate,
      findings: detection.findings,
      coverage: detection.coverage,
      context: activeContext(DateTime.local().toISODate() ?? ""),
      updatedAt: new Date().toISOString(),
    }),
    ai_insight: null,
  };

  summary.ai_insight = await generateDailyInsight(summary);

  return summary;
}
