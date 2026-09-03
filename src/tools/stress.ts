import { appConfig } from "../config.js";
import { buildToolCacheKey, withCache } from "../garmin/cache.js";
import { withGarminClient } from "../garmin/client.js";
import { fetchStressDay } from "../garmin/daily.js";
import { mapDailyStress, type DailyStressSummary } from "../garmin/rawApi.js";
import type { ToolResult } from "../garmin/types.js";
import type { StressPayload, StoredProvenance } from "./payloads.js";
import type { ToolDefinition } from "./types.js";
import { fetchEachDay } from "../garmin/partial.js";
import {
  fetchDaysOrStore,
  isPartialOrStored,
  storedFetchNote,
  type FallbackResult,
} from "../history/fallback.js";
import { average, calculateTrend, getDateRange } from "../utils/helpers.js";

async function fetchStressDays(days: number): Promise<FallbackResult<DailyStressSummary>> {
  const dates = getDateRange(days);

  return fetchDaysOrStore({
    dates,
    source: "stress",
    live: () =>
      withGarminClient(async (client) =>
        fetchEachDay(dates, async (date) => (await fetchStressDay(client, date)).mapped, "stress")
      ),
    fromRaw: (date, payload) => mapDailyStress(date, payload),
    fromMetrics: (date, metrics) => {
      const averageStress = metrics.get("stress_avg") ?? null;
      const maxStress = metrics.get("stress_max") ?? null;
      if (averageStress === null && maxStress === null) {
        return null;
      }

      return {
        date,
        averageStress,
        maxStress,
        restStress: null,
        stressDurationSeconds: null,
      };
    },
    dateOf: (day) => day.date,
  });
}

export function buildStressPayload(
  days: DailyStressSummary[],
  requestedDays: number,
  unreachableDays = 0,
  stored: StoredProvenance = {
    storedDays: 0,
    storedThrough: null,
    storedWindowMoved: false,
  }
): StressPayload {
  const averages = days
    .map((day) => day.averageStress)
    .filter((value): value is number => value !== null);

  return {
    requestedDays,
    recordedDays: days.length,
    unreachableDays,
    averageStress: averages.length > 0 ? Math.round(average(averages)) : null,
    trend: calculateTrend(averages, true),
    days,
    storedDays: stored.storedDays,
    storedThrough: stored.storedThrough,
    storedWindowMoved: stored.storedWindowMoved,
  };
}

export function renderStressText(payload: StressPayload): string {
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
    return note || `No stress data found for the last ${payload.requestedDays} days.`;
  }

  // The trend line is conditional on more than one *measured* day, not on more
  // than one recorded day: Connect returns -1 and -2 as sentinels for days the
  // watch was not worn, and those are mapped to null rather than averaged in.
  const measuredDays = payload.days.filter((day) => day.averageStress !== null).length;

  const lines = payload.days.slice(0, 7).map((day) => {
    return `${day.date}: avg ${day.averageStress ?? "n/a"}, max ${day.maxStress ?? "n/a"}`;
  });

  return [
    note,
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

  const fetched = await withCache(
    cacheKey,
    appConfig.cacheTtlStats,
    async () => fetchStressDays(days),
    { isPartial: isPartialOrStored }
  );

  const payload = buildStressPayload(fetched.values, days, fetched.unreachableDays, fetched);

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
