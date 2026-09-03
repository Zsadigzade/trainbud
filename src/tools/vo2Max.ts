import { appConfig } from "../config.js";
import { buildToolCacheKey, withCache } from "../garmin/cache.js";
import { withGarminClient } from "../garmin/client.js";
import { fetchVo2MaxDay } from "../garmin/daily.js";
import { mapMaxMetrics, type Vo2MaxEntry } from "../garmin/rawApi.js";
import type { ToolResult } from "../garmin/types.js";
import type { Vo2MaxPayload, StoredProvenance } from "./payloads.js";
import type { ToolDefinition } from "./types.js";
import { fetchEachDay } from "../garmin/partial.js";
import {
  fetchDaysOrStore,
  isPartialOrStored,
  storedFetchNote,
  type FallbackResult,
} from "../history/fallback.js";
import { calculateTrend, getDateRange } from "../utils/helpers.js";

async function fetchVo2MaxDays(days: number): Promise<FallbackResult<Vo2MaxEntry>> {
  const dates = getDateRange(days);

  // `dateOf` returns the date the reading was TAKEN, not the date asked about:
  // `maxmet/latest/<date>` ignores its date and answers with the current
  // measurement, so the same reading arrives once per day requested. Keying the
  // merge on the measured date is what collapses those duplicates -- and it
  // does the same job for a stored entry, which is why this tool needs no
  // dedupe pass of its own any more.
  return fetchDaysOrStore({
    dates,
    source: "vo2max",
    live: () =>
      withGarminClient(async (client) =>
        fetchEachDay(
          dates,
          async (date) => (await fetchVo2MaxDay(client, date)).mapped,
          "vo2max"
        )
      ),
    fromRaw: (date, payload) => mapMaxMetrics(date, payload),
    fromMetrics: (date, metrics) => {
      const vo2Max = metrics.get("vo2max") ?? null;
      const vo2MaxCycling = metrics.get("vo2max_cycling") ?? null;
      if (vo2Max === null && vo2MaxCycling === null) {
        return null;
      }

      return { date, vo2Max, vo2MaxCycling };
    },
    dateOf: (entry) => entry.date,
  });
}

export function buildVo2MaxPayload(
  entries: Vo2MaxEntry[],
  requestedDays: number,
  unreachableDays = 0,
  stored: StoredProvenance = {
    storedDays: 0,
    storedThrough: null,
    storedWindowMoved: false,
  }
): Vo2MaxPayload {
  const values = entries
    .map((entry) => entry.vo2Max)
    .filter((value): value is number => value !== null);

  return {
    requestedDays,
    recordedDays: entries.length,
    unreachableDays,
    current: entries[0]?.vo2Max ?? null,
    oldest: entries.at(-1)?.vo2Max ?? null,
    trend: calculateTrend(values, false),
    entries,
    storedDays: stored.storedDays,
    storedThrough: stored.storedThrough,
    storedWindowMoved: stored.storedWindowMoved,
  };
}

export function renderVo2MaxText(payload: Vo2MaxPayload): string {
  const note = storedFetchNote(
    {
      values: payload.entries,
      unreachableDays: payload.unreachableDays,
      requestedDays: payload.requestedDays,
      storedDays: payload.storedDays,
      storedThrough: payload.storedThrough,
      storedWindowMoved: payload.storedWindowMoved,
    },
    "days"
  );

  if (payload.recordedDays === 0) {
    return note || `No VO2 max data found for the last ${payload.requestedDays} days.`;
  }

  const measuredEntries = payload.entries.filter((entry) => entry.vo2Max !== null).length;

  const lines = payload.entries.slice(0, 10).map((entry) => {
    const cycling = entry.vo2MaxCycling !== null ? `, cycling ${entry.vo2MaxCycling}` : "";
    return `${entry.date}: VO2 max ${entry.vo2Max ?? "n/a"}${cycling}`;
  });

  return [
    note,
    `VO2 max trends over ${payload.recordedDays} recorded days:`,
    payload.current !== null ? `Current VO2 max: ${payload.current}` : "",
    payload.oldest !== null && payload.recordedDays > 1
      ? `Oldest in range: ${payload.oldest}`
      : "",
    measuredEntries > 1 ? `Trend: ${payload.trend}` : "",
    "",
    "Recent entries:",
    ...lines,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function getVo2MaxTrends(
  input: { days?: number }
): Promise<ToolResult<Vo2MaxPayload>> {
  const days = input.days ?? 30;
  const cacheKey = buildToolCacheKey("get_vo2_max_trends", { days });

  const fetched = await withCache(
    cacheKey,
    appConfig.cacheTtlStats,
    async () => fetchVo2MaxDays(days),
    { isPartial: isPartialOrStored }
  );

  const payload = buildVo2MaxPayload(fetched.values, days, fetched.unreachableDays, fetched);

  return {
    type: "text",
    text: renderVo2MaxText(payload),
    data: payload,
  };
}

export const vo2MaxToolDefinitions: ToolDefinition[] = [
  {
    name: "get_vo2_max_trends",
    description: "Returns VO2 max fitness trends over time from Garmin Connect.",
    inputSchema: {
      days: {
        type: "number",
        description: "Number of days to analyze. Defaults to 30.",
      },
    },
    handler: getVo2MaxTrends,
  },
];
