import { appConfig } from "../config.js";
import { buildToolCacheKey, withCache } from "../garmin/cache.js";
import { withGarminClient } from "../garmin/client.js";
import { fetchBodyCompositionDay } from "../garmin/daily.js";
import type { BodyCompositionEntry, ToolResult } from "../garmin/types.js";
import type { BodyCompositionPayload } from "./payloads.js";
import type { ToolDefinition } from "./types.js";
import { mapInBatches } from "../utils/batch.js";
import { calculateTrend, getDateRange } from "../utils/helpers.js";

// SECTION: Body Composition Mapping

async function fetchBodyComposition(days: number): Promise<BodyCompositionEntry[]> {
  const dates = getDateRange(days);

  const entries = await withGarminClient(async (client) => {
    const batches = await mapInBatches(dates, async (date) => {
      return (await fetchBodyCompositionDay(client, date)).mapped ?? [];
    });

    return batches.flat();
  });

  const uniqueByDate = new Map<string, BodyCompositionEntry>();
  for (const entry of entries) {
    uniqueByDate.set(entry.date, entry);
  }

  return Array.from(uniqueByDate.values()).sort((left, right) =>
    right.date.localeCompare(left.date)
  );
}

// SECTION: Tool Handler

function delta(
  current: number | null | undefined,
  baseline: number | null | undefined
): number | null {
  if (current === null || current === undefined) {
    return null;
  }
  if (baseline === null || baseline === undefined) {
    return null;
  }

  return current - baseline;
}

export function buildBodyCompositionPayload(
  entries: BodyCompositionEntry[],
  requestedDays: number
): BodyCompositionPayload {
  // Entries are sorted newest first, so the last one in the range is the
  // baseline the deltas are measured against.
  const current = entries[0] ?? null;
  const baseline = entries[entries.length - 1] ?? null;

  const measured = (select: (entry: BodyCompositionEntry) => number | null): number[] =>
    entries.map(select).filter((value): value is number => value !== null);

  return {
    requestedDays,
    recordedDays: entries.length,
    current,
    baseline,
    weightDeltaKg: delta(current?.weightKg, baseline?.weightKg),
    bodyFatDeltaPercent: delta(current?.bodyFatPercent, baseline?.bodyFatPercent),
    weightTrend: calculateTrend(measured((entry) => entry.weightKg), true),
    bodyFatTrend: calculateTrend(measured((entry) => entry.bodyFatPercent), true),
    muscleTrend: calculateTrend(measured((entry) => entry.muscleMassKg), false),
    entries,
  };
}

export function renderBodyCompositionText(payload: BodyCompositionPayload): string {
  if (payload.recordedDays === 0) {
    return `No body composition data found for the last ${payload.requestedDays} days.`;
  }

  const lines = payload.entries.slice(0, 10).map((entry) => {
    return `${entry.date}: ${entry.weightKg?.toFixed(1) ?? "n/a"} kg | body fat ${entry.bodyFatPercent?.toFixed(1) ?? "n/a"}% | muscle ${entry.muscleMassKg?.toFixed(1) ?? "n/a"} kg`;
  });

  return [
    `Body composition over ${payload.recordedDays} recorded days:`,
    `Current weight: ${payload.current?.weightKg?.toFixed(1) ?? "n/a"} kg`,
    `Current body fat: ${payload.current?.bodyFatPercent?.toFixed(1) ?? "n/a"}%`,
    `Current muscle mass: ${payload.current?.muscleMassKg?.toFixed(1) ?? "n/a"} kg`,
    `Weight change from baseline: ${payload.weightDeltaKg !== null ? `${payload.weightDeltaKg.toFixed(1)} kg` : "n/a"}`,
    `Body fat change from baseline: ${payload.bodyFatDeltaPercent !== null ? `${payload.bodyFatDeltaPercent.toFixed(1)}%` : "n/a"}`,
    `Weight trend: ${payload.weightTrend}`,
    `Body fat trend: ${payload.bodyFatTrend}`,
    `Muscle trend: ${payload.muscleTrend}`,
    "",
    "Recent entries:",
    ...lines,
  ].join("\n");
}

export async function getBodyComposition(
  input: { days?: number }
): Promise<ToolResult<BodyCompositionPayload>> {
  const days = input.days ?? 30;
  const cacheKey = buildToolCacheKey("get_body_composition", { days });

  const entries = await withCache(cacheKey, appConfig.cacheTtlStats, async () => {
    return fetchBodyComposition(days);
  });

  const payload = buildBodyCompositionPayload(entries, days);

  return {
    type: "text",
    text: renderBodyCompositionText(payload),
    data: payload,
  };
}

export const bodyCompositionToolDefinitions: ToolDefinition[] = [
  {
    name: "get_body_composition",
    description: "Returns weight, body fat, and muscle mass trends over a time period.",
    inputSchema: {
      days: {
        type: "number",
        description: "Number of days to analyze. Defaults to 30.",
      },
    },
    handler: getBodyComposition,
  },
];
