import { appConfig } from "../config.js";
import { buildToolCacheKey, withCache } from "../garmin/cache.js";
import { withGarminClient } from "../garmin/client.js";
import { fetchHeartRateDay, mapHeartRateData } from "../garmin/daily.js";
import type { HeartRateData } from "../garmin/garminApiTypes.js";
import type { HeartRateDaySummary, ToolResult } from "../garmin/types.js";
import type { HeartRatePayload, StoredProvenance } from "./payloads.js";
import type { ToolDefinition } from "./types.js";
import { fetchEachDay } from "../garmin/partial.js";
import {
  fetchDaysOrStore,
  isPartialOrStored,
  storedFetchNote,
  type FallbackResult,
} from "../history/fallback.js";
import { average, calculateTrend, getDateRange } from "../utils/helpers.js";

// SECTION: Heart Rate Mapping

async function fetchHeartRateDays(days: number): Promise<FallbackResult<HeartRateDaySummary>> {
  const dates = getDateRange(days);

  return fetchDaysOrStore({
    dates,
    source: "heart_rate",
    live: () =>
      withGarminClient(async (client) =>
        fetchEachDay(
          dates,
          async (date) => (await fetchHeartRateDay(client, date)).mapped,
          "heart-rate"
        )
      ),
    fromRaw: (date, payload) => mapHeartRateData(date, payload as HeartRateData),
    fromMetrics: (date, metrics) => {
      const restingHeartRate = metrics.get("resting_hr") ?? null;
      const maxHeartRate = metrics.get("max_hr") ?? null;
      if (restingHeartRate === null && maxHeartRate === null) {
        return null;
      }

      // minHeartRate and averageHeartRate are derived from the intraday sample
      // array, which the metric rows never held. Null says "not kept", which is
      // what the renderer already prints as n/a.
      return { date, restingHeartRate, maxHeartRate, minHeartRate: null, averageHeartRate: null };
    },
    dateOf: (day) => day.date,
  });
}

// SECTION: Tool Handler

export function buildHeartRatePayload(
  days: HeartRateDaySummary[],
  requestedDays: number,
  unreachableDays = 0,
  stored: StoredProvenance = {
    storedDays: 0,
    storedThrough: null,
    storedWindowMoved: false,
  }
): HeartRatePayload {
  const restingValues = days
    .map((day) => day.restingHeartRate)
    .filter((value): value is number => value !== null);

  return {
    requestedDays,
    recordedDays: days.length,
    unreachableDays,
    currentResting: restingValues[0] ?? null,
    // A day can be recorded with no resting reading at all. This was
    // Math.round(average([])) before, which printed "Average resting HR: NaN
    // bpm" on any range where nothing measured.
    averageResting: restingValues.length > 0 ? Math.round(average(restingValues)) : null,
    trend: calculateTrend(restingValues, true),
    days,
    storedDays: stored.storedDays,
    storedThrough: stored.storedThrough,
    storedWindowMoved: stored.storedWindowMoved,
  };
}

export function renderHeartRateText(payload: HeartRatePayload): string {
  const note = storedFetchNote(
    {
      values: payload.days,
      unreachableDays: payload.unreachableDays,
      requestedDays: payload.requestedDays,
      storedDays: payload.storedDays,
      storedThrough: payload.storedThrough,
      storedWindowMoved: payload.storedWindowMoved,
    },
    "days"
  );

  if (payload.recordedDays === 0) {
    return note || `No heart rate data found for the last ${payload.requestedDays} days.`;
  }

  const recentLines = payload.days.slice(0, 7).map((day) => {
    return `${day.date}: resting ${day.restingHeartRate ?? "n/a"} bpm, max ${day.maxHeartRate ?? "n/a"} bpm`;
  });

  const lines = [
    `Heart rate trends over ${payload.recordedDays} days:`,
    `Current resting HR: ${payload.currentResting ?? "n/a"} bpm`,
    `Average resting HR: ${payload.averageResting ?? "n/a"} bpm`,
    `Trend: ${payload.trend}`,
    "",
    "Recent days:",
    ...recentLines,
  ];

  return (note ? [note, "", ...lines] : lines).join("\n");
}

export async function getHeartRateTrends(
  input: { days?: number }
): Promise<ToolResult<HeartRatePayload>> {
  const days = input.days ?? 30;
  const cacheKey = buildToolCacheKey("get_heart_rate_trends", { days });

  const fetched = await withCache(
    cacheKey,
    appConfig.cacheTtlStats,
    async () => fetchHeartRateDays(days),
    { isPartial: isPartialOrStored }
  );

  const payload = buildHeartRatePayload(fetched.values, days, fetched.unreachableDays, fetched);

  return {
    type: "text",
    text: renderHeartRateText(payload),
    data: payload,
  };
}

export const heartRateToolDefinitions: ToolDefinition[] = [
  {
    name: "get_heart_rate_trends",
    description: "Returns resting, max, and average heart rate trends over a time period.",
    inputSchema: {
      days: {
        type: "number",
        description: "Number of days to analyze. Defaults to 30.",
      },
    },
    handler: getHeartRateTrends,
  },
];
