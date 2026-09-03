import { appConfig } from "../config.js";
import { buildToolCacheKey, withCache } from "../garmin/cache.js";
import { withGarminClient } from "../garmin/client.js";
import { fetchSleepDay, mapSleepData } from "../garmin/daily.js";
import type { SleepData } from "../garmin/garminApiTypes.js";
import type { SleepNightSummary, ToolResult } from "../garmin/types.js";
import type { SleepPayload, StoredProvenance } from "./payloads.js";
import type { ToolDefinition } from "./types.js";
import { fetchEachDay } from "../garmin/partial.js";
import {
  fetchDaysOrStore,
  isPartialOrStored,
  storedFetchNote,
  type FallbackResult,
} from "../history/fallback.js";
import { formatDuration, getDateRange } from "../utils/helpers.js";

// SECTION: Sleep Mapping

async function fetchSleepNights(days: number): Promise<FallbackResult<SleepNightSummary>> {
  const dates = getDateRange(days);

  return fetchDaysOrStore({
    dates,
    source: "sleep",
    live: () =>
      withGarminClient(async (client) =>
        fetchEachDay(dates, async (date) => (await fetchSleepDay(client, date)).mapped, "sleep")
      ),
    // The same mapper the live path uses, re-run over the archived response. A
    // second mapping here would be a second place for "which field is the sleep
    // score" to be answered, and this project has already shipped a mapper
    // reading a field Connect does not send.
    fromRaw: (date, payload) => mapSleepData(date, payload as SleepData),
    fromMetrics: (date, metrics) => {
      const totalSleepSeconds = metrics.get("sleep_seconds");
      if (totalSleepSeconds === undefined) {
        return null;
      }

      return {
        date,
        totalSleepSeconds,
        deepSleepSeconds: null,
        lightSleepSeconds: null,
        remSleepSeconds: null,
        awakeCount: null,
        sleepScore: metrics.get("sleep_score") ?? null,
        avgSleepStress: metrics.get("sleep_stress") ?? null,
        avgOvernightHrv: metrics.get("hrv_overnight") ?? null,
        hrvStatus: null,
      };
    },
    dateOf: (night) => night.date,
  });
}

function formatSleepNight(night: SleepNightSummary): string {
  const stages =
    night.deepSleepSeconds === null &&
    night.lightSleepSeconds === null &&
    night.remSleepSeconds === null
      ? "  Stages: not kept for this night"
      : `  Deep: ${formatDuration(night.deepSleepSeconds)} | Light: ${formatDuration(night.lightSleepSeconds)} | REM: ${formatDuration(night.remSleepSeconds)}`;

  return [
    `${night.date}:`,
    `  Total sleep: ${formatDuration(night.totalSleepSeconds)}`,
    stages,
    `  Score: ${night.sleepScore ?? "n/a"} | Awakenings: ${night.awakeCount ?? "n/a"}`,
    `  Avg sleep stress: ${night.avgSleepStress ?? "n/a"}`,
  ].join("\n");
}

// SECTION: Tool Handler

export function buildSleepPayload(
  nights: SleepNightSummary[],
  requestedNights: number,
  unreachableNights = 0,
  stored: StoredProvenance = {
    storedDays: 0,
    storedThrough: null,
    storedWindowMoved: false,
  }
): SleepPayload {
  const scored = nights
    .map((night) => night.sleepScore)
    .filter((score): score is number => score !== null);

  const averageScore =
    scored.length > 0
      ? Math.round(scored.reduce((sum, score) => sum + score, 0) / scored.length)
      : null;

  return {
    requestedNights,
    recordedNights: nights.length,
    unreachableNights,
    averageScore,
    nights,
    storedNights: stored.storedDays,
    storedThrough: stored.storedThrough,
    storedWindowMoved: stored.storedWindowMoved,
  };
}

export function renderSleepText(payload: SleepPayload): string {
  const note = storedFetchNote(
    {
      values: payload.nights,
      unreachableDays: payload.unreachableNights,
      requestedDays: payload.requestedNights,
      storedDays: payload.storedNights,
      storedThrough: payload.storedThrough,
      storedWindowMoved: payload.storedWindowMoved,
    },
    "nights"
  );

  if (payload.recordedNights === 0) {
    return note || `No sleep data found for the last ${payload.requestedNights} nights.`;
  }

  return [
    note,
    `Sleep summary for last ${payload.recordedNights} recorded nights:`,
    payload.averageScore !== null ? `Average sleep score: ${payload.averageScore}` : "",
    "",
    ...payload.nights.map(formatSleepNight),
  ]
    .filter(Boolean)
    .join("\n");
}

export async function getSleepDataTool(
  input: { nights?: number }
): Promise<ToolResult<SleepPayload>> {
  const nights = input.nights ?? 7;
  const cacheKey = buildToolCacheKey("get_sleep_data", { nights });

  const fetched = await withCache(
    cacheKey,
    appConfig.cacheTtlSleep,
    async () => fetchSleepNights(nights),
    { isPartial: isPartialOrStored }
  );

  const payload = buildSleepPayload(fetched.values, nights, fetched.unreachableDays, fetched);

  return {
    type: "text",
    text: renderSleepText(payload),
    data: payload,
  };
}

export const sleepToolDefinitions: ToolDefinition[] = [
  {
    name: "get_sleep_data",
    description: "Returns sleep duration, quality score, stage breakdown, and interruptions for recent nights.",
    inputSchema: {
      nights: {
        type: "number",
        description: "Number of recent nights to include. Defaults to 7.",
      },
    },
    handler: getSleepDataTool,
  },
];
