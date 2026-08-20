import { appConfig } from "../config.js";
import { buildToolCacheKey, withCache } from "../garmin/cache.js";
import { withGarminClient } from "../garmin/client.js";
import {
  fetchDailyStress,
  mapDailyStress,
  type DailyStressSummary,
} from "../garmin/rawApi.js";
import type { ToolResult } from "../garmin/types.js";
import type { StressPayload } from "./payloads.js";
import type { ToolDefinition } from "./types.js";
import { mapInBatches } from "../utils/batch.js";
import { average, calculateTrend, getDateRange } from "../utils/helpers.js";

async function fetchStressDays(days: number): Promise<DailyStressSummary[]> {
  const dates = getDateRange(days);

  return withGarminClient(async (client) => {
    const summaries = await mapInBatches(dates, async (date) => {
      try {
        const payload = await fetchDailyStress(client, date);
        return mapDailyStress(date, payload);
      } catch {
        return null;
      }
    });

    return summaries.filter((entry): entry is DailyStressSummary => entry !== null);
  });
}

export function buildStressPayload(
  days: DailyStressSummary[],
  requestedDays: number
): StressPayload {
  const averages = days
    .map((day) => day.averageStress)
    .filter((value): value is number => value !== null);

  return {
    requestedDays,
    recordedDays: days.length,
    averageStress: averages.length > 0 ? Math.round(average(averages)) : null,
    trend: calculateTrend(averages, true),
    days,
  };
}

export function renderStressText(payload: StressPayload): string {
  if (payload.recordedDays === 0) {
    return `No stress data found for the last ${payload.requestedDays} days.`;
  }

  // The trend line is conditional on more than one *measured* day, not on more
  // than one recorded day: Connect returns -1 and -2 as sentinels for days the
  // watch was not worn, and those are mapped to null rather than averaged in.
  const measuredDays = payload.days.filter((day) => day.averageStress !== null).length;

  const lines = payload.days.slice(0, 7).map((day) => {
    return `${day.date}: avg ${day.averageStress ?? "n/a"}, max ${day.maxStress ?? "n/a"}`;
  });

  return [
    `Stress levels over ${payload.recordedDays} recorded days:`,
    payload.averageStress !== null ? `Average stress: ${payload.averageStress}` : "",
    measuredDays > 1 ? `Trend: ${payload.trend}` : "",
    "",
    "Recent days:",
    ...lines,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function getStressLevels(
  input: { days?: number }
): Promise<ToolResult<StressPayload>> {
  const days = input.days ?? 7;
  const cacheKey = buildToolCacheKey("get_stress_levels", { days });

  const summaries = await withCache(cacheKey, appConfig.cacheTtlStats, async () => {
    return fetchStressDays(days);
  });

  const payload = buildStressPayload(summaries, days);

  return {
    type: "text",
    text: renderStressText(payload),
    data: payload,
  };
}

export const stressToolDefinitions: ToolDefinition[] = [
  {
    name: "get_stress_levels",
    description: "Returns daily stress averages and trends from Garmin Connect.",
    inputSchema: {
      days: {
        type: "number",
        description: "Number of days to analyze. Defaults to 7.",
      },
    },
    handler: getStressLevels,
  },
];
