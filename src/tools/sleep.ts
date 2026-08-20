import { appConfig } from "../config.js";
import { buildToolCacheKey, withCache } from "../garmin/cache.js";
import { withGarminClient } from "../garmin/client.js";
import { fetchSleepDay } from "../garmin/daily.js";
import type { SleepNightSummary, ToolResult } from "../garmin/types.js";
import type { SleepPayload } from "./payloads.js";
import type { ToolDefinition } from "./types.js";
import { mapInBatches } from "../utils/batch.js";
import { formatDuration, getDateRange } from "../utils/helpers.js";

// SECTION: Sleep Mapping

async function fetchSleepNights(days: number): Promise<SleepNightSummary[]> {
  const dates = getDateRange(days);

  return withGarminClient(async (client) => {
    const nights = await mapInBatches(dates, async (date) => {
      try {
        return (await fetchSleepDay(client, date)).mapped;
      } catch {
        return null;
      }
    });

    return nights.filter((night): night is SleepNightSummary => night !== null);
  });
}

function formatSleepNight(night: SleepNightSummary): string {
  return [
    `${night.date}:`,
    `  Total sleep: ${formatDuration(night.totalSleepSeconds)}`,
    `  Deep: ${formatDuration(night.deepSleepSeconds)} | Light: ${formatDuration(night.lightSleepSeconds)} | REM: ${formatDuration(night.remSleepSeconds)}`,
    `  Score: ${night.sleepScore ?? "n/a"} | Awakenings: ${night.awakeCount}`,
    `  Avg sleep stress: ${night.avgSleepStress ?? "n/a"}`,
  ].join("\n");
}

// SECTION: Tool Handler

export function buildSleepPayload(
  nights: SleepNightSummary[],
  requestedNights: number
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
    averageScore,
    nights,
  };
}

export function renderSleepText(payload: SleepPayload): string {
  if (payload.recordedNights === 0) {
    return `No sleep data found for the last ${payload.requestedNights} nights.`;
  }

  return [
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

  const sleepNights = await withCache(cacheKey, appConfig.cacheTtlSleep, async () => {
    return fetchSleepNights(nights);
  });

  const payload = buildSleepPayload(sleepNights, nights);

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
