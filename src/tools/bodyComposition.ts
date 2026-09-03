import { appConfig } from "../config.js";
import { buildToolCacheKey, withCache } from "../garmin/cache.js";
import { withGarminClient } from "../garmin/client.js";
import { fetchBodyCompositionDay, mapWeightData } from "../garmin/daily.js";
import type { WeightDataResponse } from "../garmin/garminApiTypes.js";
import type { BodyCompositionEntry, ToolResult } from "../garmin/types.js";
import type { BodyCompositionPayload, StoredProvenance } from "./payloads.js";
import type { ToolDefinition } from "./types.js";
import { mapInBatches } from "../utils/batch.js";
import { fetchDaysOrStore, isPartialOrStored, storedFetchNote } from "../history/fallback.js";
import { calculateTrend, getDateRange } from "../utils/helpers.js";

// SECTION: Body Composition Mapping

/**
 * A weight response covers a whole day and may carry several readings, so this
 * flattens to one entry per date rather than one per request -- but it still
 * goes through the same fallback as every other metric, because a scale reading
 * that was fetched last week is still the user's weight when Connect will not
 * answer today.
 */
async function fetchBodyComposition(
  days: number
): Promise<{ entries: BodyCompositionEntry[]; unreachableDays: number } & StoredProvenance> {
  const dates = getDateRange(days);

  const result = await fetchDaysOrStore<BodyCompositionEntry>({
    dates,
    source: "body_composition",
    live: async () => {
      const batches = await withGarminClient(async (client) =>
        mapInBatches(dates, async (date) => (await fetchBodyCompositionDay(client, date)).mapped ?? [])
      );

      return { values: batches.flat(), unreachableDays: 0, requestedDays: dates.length };
    },
    fromRaw: (date, payload) => mapWeightData(date, payload as WeightDataResponse)[0] ?? null,
    fromMetrics: (date, metrics) => {
      const weightKg = metrics.get("weight_kg") ?? null;
      const bodyFatPercent = metrics.get("body_fat_pct") ?? null;
      const muscleMassKg = metrics.get("muscle_mass_kg") ?? null;
      if (weightKg === null && bodyFatPercent === null && muscleMassKg === null) {
        return null;
      }

      return { date, weightKg, bodyFatPercent, muscleMassKg, bmi: null };
    },
    dateOf: (entry) => entry.date,
  });

  return {
    entries: result.values,
    storedDays: result.storedDays,
    storedThrough: result.storedThrough,
    storedWindowMoved: result.storedWindowMoved,
    unreachableDays: result.unreachableDays,
  };
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
  requestedDays: number,
  stored: StoredProvenance = {
    storedDays: 0,
    storedThrough: null,
    storedWindowMoved: false,
  }
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
    storedDays: stored.storedDays,
    storedThrough: stored.storedThrough,
    storedWindowMoved: stored.storedWindowMoved,
  };
}

export function renderBodyCompositionText(payload: BodyCompositionPayload): string {
  const note = storedFetchNote(
    {
      values: payload.entries,
      unreachableDays: 0,
      requestedDays: payload.requestedDays,
      storedDays: payload.storedDays,
      storedThrough: payload.storedThrough,
      storedWindowMoved: payload.storedWindowMoved,
    },
    "days"
  );

  if (payload.recordedDays === 0) {
    return note || `No body composition data found for the last ${payload.requestedDays} days.`;
  }

  const lines = payload.entries.slice(0, 10).map((entry) => {
    return `${entry.date}: ${entry.weightKg?.toFixed(1) ?? "n/a"} kg | body fat ${entry.bodyFatPercent?.toFixed(1) ?? "n/a"}% | muscle ${entry.muscleMassKg?.toFixed(1) ?? "n/a"} kg`;
  });

  // Prepended rather than filtered into the list: the blank line before
  // "Recent entries:" is deliberate, so a `.filter(Boolean)` here would drop the
  // separator along with the empty note.
  return [
    ...(note ? [note, ""] : []),
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

  const fetched = await withCache(
    cacheKey,
    appConfig.cacheTtlStats,
    async () => fetchBodyComposition(days),
    { isPartial: isPartialOrStored }
  );

  const payload = buildBodyCompositionPayload(fetched.entries, days, fetched);

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
