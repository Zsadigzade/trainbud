import type { SleepData } from "../garmin/garminApiTypes.js";
import { appConfig } from "../config.js";
import { buildToolCacheKey, withCache } from "../garmin/cache.js";
import { withGarminClient } from "../garmin/client.js";
import type { RecoveryStatusResult, RecoveryWeights, ToolResult } from "../garmin/types.js";
import type { RecoveryPayload } from "./payloads.js";
import type { ToolDefinition } from "./types.js";
import { clamp, formatIsoDate, getDateRange, getYesterday } from "../utils/helpers.js";

// SECTION: Recovery Scoring

const DEFAULT_WEIGHTS: RecoveryWeights = {
  hrv: 0.3,
  sleep: 0.3,
  stress: 0.2,
  restingHr: 0.2,
};

export function normalizeWeights(weights?: Partial<RecoveryWeights>): RecoveryWeights {
  // Spreading the caller's object was wrong: getRecoveryStatus builds
  // { hrv: input.hrv_weight, ... } from an input that usually carries no
  // weights at all, so every key is present and explicitly undefined, and a
  // spread of explicit undefined overwrites the default it was meant to fall
  // back to. The total then came out NaN; `NaN <= 0` is false, so the guard
  // below waved it through, every component was multiplied by NaN, and the
  // score was NaN -- which JSON.stringify writes as null. That is how the
  // cache, the tool output and the watch all ended up showing
  // "Recovery score: null/100" with four healthy component scores beneath it.
  const merged: RecoveryWeights = { ...DEFAULT_WEIGHTS };
  for (const key of Object.keys(DEFAULT_WEIGHTS) as (keyof RecoveryWeights)[]) {
    const value = weights?.[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      merged[key] = value;
    }
  }

  const total = merged.hrv + merged.sleep + merged.stress + merged.restingHr;

  if (!Number.isFinite(total) || total <= 0) {
    return DEFAULT_WEIGHTS;
  }

  return {
    hrv: merged.hrv / total,
    sleep: merged.sleep / total,
    stress: merged.stress / total,
    restingHr: merged.restingHr / total,
  };
}

export function scoreFromHrv(hrv: number | null, status: string | null): number {
  if (hrv === null) {
    if (status === "BALANCED") {
      return 80;
    }
    if (status === "LOW") {
      return 45;
    }
    return 60;
  }

  if (hrv >= 60) {
    return 95;
  }
  if (hrv >= 45) {
    return 80;
  }
  if (hrv >= 30) {
    return 60;
  }
  return 40;
}

export function scoreFromSleep(score: number | null, durationSeconds: number): number {
  if (score !== null) {
    return clamp(score, 0, 100);
  }

  const hours = durationSeconds / 3600;
  if (hours >= 8) {
    return 90;
  }
  if (hours >= 7) {
    return 75;
  }
  if (hours >= 6) {
    return 55;
  }
  return 35;
}

export function scoreFromStress(stress: number | null): number {
  if (stress === null) {
    return 60;
  }

  if (stress <= 15) {
    return 95;
  }
  if (stress <= 25) {
    return 75;
  }
  if (stress <= 35) {
    return 55;
  }
  return 35;
}

export function scoreFromRestingHr(restingHr: number | null, baseline: number | null): number {
  if (restingHr === null) {
    return 60;
  }

  if (baseline === null) {
    if (restingHr <= 50) {
      return 90;
    }
    if (restingHr <= 60) {
      return 80;
    }
    if (restingHr <= 70) {
      return 65;
    }
    return 45;
  }

  const delta = restingHr - baseline;
  if (delta <= -2) {
    return 90;
  }
  if (delta <= 2) {
    return 75;
  }
  if (delta <= 5) {
    return 55;
  }
  return 35;
}

export function buildRecoveryStatus(
  components: RecoveryStatusResult["components"],
  weights: RecoveryWeights
): RecoveryStatusResult {
  const score = Math.round(
    components.hrvScore * weights.hrv +
      components.sleepScore * weights.sleep +
      components.stressScore * weights.stress +
      components.restingHrScore * weights.restingHr
  );

  let status: RecoveryStatusResult["status"] = "good";
  let recommendation = "Moderate training is reasonable. Listen to your body during hard efforts.";

  if (score >= 80) {
    status = "recovered";
    recommendation = "You look recovered. Hard training or a quality session is appropriate today.";
  } else if (score < 60) {
    status = "fatigued";
    recommendation = "Recovery looks limited. Favor easy training, mobility, or a rest day.";
  }

  return {
    score,
    status,
    recommendation,
    components,
  };
}

async function fetchRecoverySignals(): Promise<{
  sleepData: SleepData;
  restingHeartRate: number | null;
  baselineRestingHeartRate: number | null;
}> {
  const today = new Date();
  const candidates = [getYesterday(), ...getDateRange(3).slice(1)];

  return withGarminClient(async (client) => {
    let sleepData: SleepData = { dailySleepDTO: undefined };

    for (const date of candidates) {
      const candidate = await client.getSleepData(date);
      if (candidate.dailySleepDTO) {
        sleepData = candidate;
        break;
      }
    }

    const heartRate = await client.getHeartRate(today);

    return {
      sleepData,
      restingHeartRate: heartRate.restingHeartRate ?? null,
      baselineRestingHeartRate: heartRate.lastSevenDaysAvgRestingHeartRate ?? null,
    };
  });
}

// SECTION: Tool Handler

/**
 * The date is passed in rather than read from the clock here, which is what
 * keeps this pure and testable -- the handler below supplies it.
 */
export function renderRecoveryText(payload: RecoveryPayload): string {
  const { recovery } = payload;

  return [
    `Recovery score: ${recovery.score}/100 (${recovery.status})`,
    recovery.recommendation,
    "",
    "Component scores:",
    `- HRV: ${recovery.components.hrvScore}`,
    `- Sleep: ${recovery.components.sleepScore}`,
    `- Stress: ${recovery.components.stressScore}`,
    `- Resting HR: ${recovery.components.restingHrScore}`,
    "",
    `Date: ${payload.date}`,
  ].join("\n");
}

export async function getRecoveryStatus(input: {
  hrv_weight?: number;
  sleep_weight?: number;
  stress_weight?: number;
  resting_hr_weight?: number;
}): Promise<ToolResult<RecoveryPayload>> {
  const weights = normalizeWeights({
    hrv: input.hrv_weight,
    sleep: input.sleep_weight,
    stress: input.stress_weight,
    restingHr: input.resting_hr_weight,
  });

  const cacheKey = buildToolCacheKey("get_recovery_status", {
    hrv: weights.hrv,
    sleep: weights.sleep,
    stress: weights.stress,
    restingHr: weights.restingHr,
  });

  const recovery = await withCache(cacheKey, appConfig.cacheTtlStats, async () => {
    const signals = await fetchRecoverySignals();
    const sleep = signals.sleepData.dailySleepDTO;

    const components = {
      hrvScore: scoreFromHrv(
        signals.sleepData.avgOvernightHrv ?? null,
        signals.sleepData.hrvStatus ?? null
      ),
      sleepScore: scoreFromSleep(
        sleep?.sleepScores?.overall?.value ?? null,
        sleep?.sleepTimeSeconds ?? 0
      ),
      stressScore: scoreFromStress(sleep?.avgSleepStress ?? null),
      restingHrScore: scoreFromRestingHr(
        signals.restingHeartRate,
        signals.baselineRestingHeartRate
      ),
    };

    return buildRecoveryStatus(components, weights);
  });

  const payload: RecoveryPayload = { date: formatIsoDate(new Date()), recovery };

  return {
    type: "text",
    text: renderRecoveryText(payload),
    data: payload,
  };
}

export const recoveryToolDefinitions: ToolDefinition[] = [
  {
    name: "get_recovery_status",
    description:
      "Combines HRV, sleep, stress, and resting heart rate into a recovery score and training recommendation.",
    inputSchema: {
      hrv_weight: {
        type: "number",
        description: "Optional weight for HRV in the recovery score.",
      },
      sleep_weight: {
        type: "number",
        description: "Optional weight for sleep in the recovery score.",
      },
      stress_weight: {
        type: "number",
        description: "Optional weight for stress in the recovery score.",
      },
      resting_hr_weight: {
        type: "number",
        description: "Optional weight for resting heart rate in the recovery score.",
      },
    },
    handler: getRecoveryStatus,
  },
];
