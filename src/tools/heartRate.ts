import { appConfig } from "../config.js";
import { buildToolCacheKey, withCache } from "../garmin/cache.js";
import { withGarminClient } from "../garmin/client.js";
import { fetchHeartRateDay } from "../garmin/daily.js";
import type { HeartRateDaySummary, ToolResult } from "../garmin/types.js";
import type { HeartRatePayload } from "./payloads.js";
import type { ToolDefinition } from "./types.js";
import { mapInBatches } from "../utils/batch.js";
import { average, calculateTrend, getDateRange } from "../utils/helpers.js";

// SECTION: Heart Rate Mapping

async function fetchHeartRateDays(days: number): Promise<HeartRateDaySummary[]> {
  const dates = getDateRange(days);

  return withGarminClient(async (client) => {
    const summaries = await mapInBatches(dates, async (date) => {
      try {
        return (await fetchHeartRateDay(client, date)).mapped;
      } catch {
        return null;
      }
    });

    return summaries.filter((summary): summary is HeartRateDaySummary => summary !== null);
  });
}

// SECTION: Tool Handler

export function buildHeartRatePayload(
  days: HeartRateDaySummary[],
  requestedDays: number
): HeartRatePayload {
  const restingValues = days
    .map((day) => day.restingHeartRate)
    .filter((value): value is number => value !== null);

  return {
    requestedDays,
    recordedDays: days.length,
    currentResting: restingValues[0] ?? null,
    // A day can be recorded with no resting reading at all. This was
    // Math.round(average([])) before, which printed "Average resting HR: NaN
    // bpm" on any range where nothing measured.
    averageResting: restingValues.length > 0 ? Math.round(average(restingValues)) : null,
    trend: calculateTrend(restingValues, true),
    days,
  };
}

export function renderHeartRateText(payload: HeartRatePayload): string {
  if (payload.recordedDays === 0) {
    return `No heart rate data found for the last ${payload.requestedDays} days.`;
  }

  const recentLines = payload.days.slice(0, 7).map((day) => {
    return `${day.date}: resting ${day.restingHeartRate ?? "n/a"} bpm, max ${day.maxHeartRate ?? "n/a"} bpm`;
  });

  return [
    `Heart rate trends over ${payload.recordedDays} days:`,
    `Current resting HR: ${payload.currentResting ?? "n/a"} bpm`,
    `Average resting HR: ${payload.averageResting ?? "n/a"} bpm`,
    `Trend: ${payload.trend}`,
    "",
    "Recent days:",
    ...recentLines,
  ].join("\n");
}

export async function getHeartRateTrends(
  input: { days?: number }
): Promise<ToolResult<HeartRatePayload>> {
  const days = input.days ?? 30;
  const cacheKey = buildToolCacheKey("get_heart_rate_trends", { days });

  const summaries = await withCache(cacheKey, appConfig.cacheTtlStats, async () => {
    return fetchHeartRateDays(days);
  });

  const payload = buildHeartRatePayload(summaries, days);

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
