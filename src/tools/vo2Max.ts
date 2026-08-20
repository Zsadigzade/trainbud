import { appConfig } from "../config.js";
import { buildToolCacheKey, withCache } from "../garmin/cache.js";
import { withGarminClient } from "../garmin/client.js";
import { fetchVo2MaxDay } from "../garmin/daily.js";
import type { Vo2MaxEntry } from "../garmin/rawApi.js";
import type { ToolResult } from "../garmin/types.js";
import type { Vo2MaxPayload } from "./payloads.js";
import type { ToolDefinition } from "./types.js";
import { mapInBatches } from "../utils/batch.js";
import { calculateTrend, getDateRange } from "../utils/helpers.js";

async function fetchVo2MaxDays(days: number): Promise<Vo2MaxEntry[]> {
  const dates = getDateRange(days);

  return withGarminClient(async (client) => {
    const entries = await mapInBatches(dates, async (date) => {
      try {
        return (await fetchVo2MaxDay(client, date)).mapped;
      } catch {
        return null;
      }
    });

    // Every requested date comes back with whatever the latest reading is, so
    // the same measurement arrives once per day asked about. Keyed on the date
    // it was actually taken, the duplicates collapse into the real series.
    const byMeasuredDate = new Map<string, Vo2MaxEntry>();
    for (const entry of entries) {
      if (entry !== null) {
        byMeasuredDate.set(entry.date, entry);
      }
    }

    return Array.from(byMeasuredDate.values()).sort((left, right) =>
      right.date.localeCompare(left.date)
    );
  });
}

export function buildVo2MaxPayload(
  entries: Vo2MaxEntry[],
  requestedDays: number
): Vo2MaxPayload {
  const values = entries
    .map((entry) => entry.vo2Max)
    .filter((value): value is number => value !== null);

  return {
    requestedDays,
    recordedDays: entries.length,
    current: entries[0]?.vo2Max ?? null,
    oldest: entries.at(-1)?.vo2Max ?? null,
    trend: calculateTrend(values, false),
    entries,
  };
}

export function renderVo2MaxText(payload: Vo2MaxPayload): string {
  if (payload.recordedDays === 0) {
    return `No VO2 max data found for the last ${payload.requestedDays} days.`;
  }

  const measuredEntries = payload.entries.filter((entry) => entry.vo2Max !== null).length;

  const lines = payload.entries.slice(0, 10).map((entry) => {
    const cycling = entry.vo2MaxCycling !== null ? `, cycling ${entry.vo2MaxCycling}` : "";
    return `${entry.date}: VO2 max ${entry.vo2Max ?? "n/a"}${cycling}`;
  });

  return [
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

  const entries = await withCache(cacheKey, appConfig.cacheTtlStats, async () => {
    return fetchVo2MaxDays(days);
  });

  const payload = buildVo2MaxPayload(entries, days);

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
