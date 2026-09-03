import type { SleepData } from "../garmin/garminApiTypes.js";
import { storedRawPayload, isPartialOrStored } from "../history/fallback.js";
import { getMetricsOn } from "../history/store.js";
import { logger } from "../utils/logger.js";
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

/**
 * Null when the night was not measured at all.
 *
 * The call site passed `sleep?.sleepTimeSeconds ?? 0`, so a night with no sleep
 * record became zero seconds, fell through every band, and scored 35 out of 100
 * -- a confident bad-night verdict manufactured out of an unworn watch. An hour
 * is the floor for "this is a measurement": nobody's real night is shorter, and
 * Garmin does report tiny durations for naps and for partial wear.
 */
export function scoreFromSleep(score: number | null, durationSeconds: number): number | null {
  if (score !== null) {
    return clamp(score, 0, 100);
  }

  if (durationSeconds < 3600) {
    return null;
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
  // A component that was never measured is dropped and its weight redistributed
  // across the rest, rather than being scored as though it had been measured
  // badly. Scoring an absence is how an unworn night became "fatigued".
  const parts: { value: number; weight: number }[] = [
    { value: components.hrvScore, weight: weights.hrv },
    { value: components.stressScore, weight: weights.stress },
    { value: components.restingHrScore, weight: weights.restingHr },
  ];
  if (components.sleepScore !== null) {
    parts.push({ value: components.sleepScore, weight: weights.sleep });
  }

  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  const score =
    totalWeight > 0
      ? Math.round(
          parts.reduce((sum, part) => sum + part.value * part.weight, 0) / totalWeight
        )
      : 0;

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

interface RecoverySignals {
  sleepData: SleepData;
  restingHeartRate: number | null;
  baselineRestingHeartRate: number | null;
  /** The date these signals were measured, when they came out of the store. */
  storedThrough: string | null;
}

/**
 * How far back the store is searched for the most recent night with a record.
 * Past this the answer stops being a recovery score and becomes an anecdote,
 * and saying nothing is better than scoring it.
 */
const STORED_SIGNAL_WINDOW_DAYS = 30;

/**
 * The same signals, read out of the store, when Connect will not answer.
 *
 * Every component already has an honest null path -- `scoreFromSleep` returns
 * null for a night that was not measured and the weights renormalise around it
 * -- so a partial reconstruction degrades rather than inventing. What it must
 * not do is pretend to be current, which is what `storedThrough` is for: the
 * renderer names the date and `buildWatchSummary` refuses the card once that
 * date is old.
 */
function storedRecoverySignals(): RecoverySignals | null {
  for (const date of getDateRange(STORED_SIGNAL_WINDOW_DAYS)) {
    const iso = formatIsoDate(date);
    const raw = storedRawPayload(iso, "sleep") as SleepData | null;
    const metrics = getMetricsOn(iso);

    if (raw?.dailySleepDTO) {
      return {
        sleepData: raw,
        restingHeartRate: metrics.get("resting_hr") ?? null,
        baselineRestingHeartRate: null,
        storedThrough: iso,
      };
    }

    // No archived response, but the derived rows survive pruning forever.
    const sleepSeconds = metrics.get("sleep_seconds");
    if (sleepSeconds !== undefined) {
      return {
        sleepData: {
          dailySleepDTO: {
            sleepTimeSeconds: sleepSeconds,
            avgSleepStress: metrics.get("sleep_stress") ?? null,
            sleepScores: { overall: { value: metrics.get("sleep_score") ?? null } },
          },
          avgOvernightHrv: metrics.get("hrv_overnight") ?? null,
          hrvStatus: null,
        } as unknown as SleepData,
        restingHeartRate: metrics.get("resting_hr") ?? null,
        baselineRestingHeartRate: null,
        storedThrough: iso,
      };
    }
  }

  return null;
}

async function fetchRecoverySignals(): Promise<RecoverySignals> {
  const today = new Date();
  const candidates = [getYesterday(), ...getDateRange(3).slice(1)];

  try {
    return await withGarminClient(async (client) => {
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
        storedThrough: null,
      };
    });
  } catch (error) {
    // A recovery score built on an expired session used to be a thrown tool
    // error, which an MCP client reports as having no access to the user's
    // data. The signals are in the store; what changes is the date they
    // describe, and that is something to say rather than a reason to say
    // nothing at all.
    const stored = storedRecoverySignals();
    if (!stored) {
      throw error;
    }

    logger.info(
      { err: error, storedThrough: stored.storedThrough },
      "Recovery signals came from the stored history"
    );
    return stored;
  }
}

// SECTION: Tool Handler

/**
 * The date is passed in rather than read from the clock here, which is what
 * keeps this pure and testable -- the handler below supplies it.
 */
export function renderRecoveryText(payload: RecoveryPayload): string {
  const { recovery } = payload;

  const provenance = payload.storedThrough
    ? [
        `Garmin could not be reached, so this was computed from TrainBud's stored record for ${payload.storedThrough} rather than from today's figures.`,
        "It describes that day. Do not present it as current, and do not report it as an absence of data.",
        "",
      ]
    : [];

  return [
    ...provenance,
    `Recovery score: ${recovery.score}/100 (${recovery.status})`,
    recovery.recommendation,
    "",
    "Component scores:",
    `- HRV: ${recovery.components.hrvScore}`,
    `- Sleep: ${recovery.components.sleepScore ?? "not measured"}`,
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

  const computed = await withCache(
    cacheKey,
    appConfig.cacheTtlStats,
    async () => {
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

      return {
        recovery: buildRecoveryStatus(components, weights),
        storedThrough: signals.storedThrough,
      };
    },
    {
      isPartial: (value) =>
        isPartialOrStored({ unreachableDays: 0, storedDays: value.storedThrough ? 1 : 0 }),
    }
  );

  const payload: RecoveryPayload = {
    // The day the score describes, which is the stored day when the signals
    // came from the store. Stamping it with today is how a fortnight-old night
    // would have been served as this morning's recovery.
    date: computed.storedThrough ?? formatIsoDate(new Date()),
    recovery: computed.recovery,
    storedThrough: computed.storedThrough,
  };

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
