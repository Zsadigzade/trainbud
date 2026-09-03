import { appConfig } from "../config.js";
import { buildToolCacheKey, withCache } from "../garmin/cache.js";
import { withGarminClient } from "../garmin/client.js";
import { mapActivity } from "../garmin/daily.js";
import type { ActivitySummary, ToolResult } from "../garmin/types.js";
import type { ActivitiesRangePayload, LatestActivityPayload } from "./payloads.js";
import type { ToolDefinition } from "./types.js";
import { storedActivitiesBetween } from "../history/fallback.js";
import { logger } from "../utils/logger.js";
import { DateTime } from "luxon";
import {
  filterActivitiesByRange,
  formatDistanceMeters,
  formatDuration,
  formatIsoDate,
  formatPaceMetersPerSecond,
  parseActivityLocalDateTime,
} from "../utils/helpers.js";

import { getProfile } from "../profile.js";

const ACTIVITIES_PAGE_SIZE = 100;
const MAX_ACTIVITIES_FETCH = 500;

// SECTION: Activity Mapping

export function formatActivitySummary(
  activity: ActivitySummary,
  units: "metric" | "imperial" = "metric"
): string {
  return [
    `Activity: ${activity.name}`,
    `Type: ${activity.type}`,
    `Date: ${activity.startTimeLocal}`,
    `Distance: ${formatDistanceMeters(activity.distanceMeters, units)}`,
    `Duration: ${formatDuration(activity.durationSeconds)}`,
    `Pace: ${formatPaceMetersPerSecond(activity.averageSpeedMps, units)}`,
    `Avg HR: ${activity.averageHeartRate ?? "n/a"} bpm`,
    `Max HR: ${activity.maxHeartRate ?? "n/a"} bpm`,
    `Elevation gain: ${activity.elevationGainMeters === null ? "n/a" : `${activity.elevationGainMeters.toFixed(0)} m`}`,
    `Calories: ${activity.calories ?? "n/a"}`,
  ].join("\n");
}

async function fetchActivitiesPage(start: number, limit: number): Promise<ActivitySummary[]> {
  return withGarminClient(async (client) => {
    const activities = await client.getActivities(start, limit);
    return activities.map(mapActivity);
  });
}

async function fetchActivitiesPool(): Promise<{ activities: ActivitySummary[]; truncated: boolean }> {
  const all: ActivitySummary[] = [];
  let start = 0;

  while (all.length < MAX_ACTIVITIES_FETCH) {
    const page = await fetchActivitiesPage(start, ACTIVITIES_PAGE_SIZE);
    if (page.length === 0) {
      break;
    }

    all.push(...page);

    if (page.length < ACTIVITIES_PAGE_SIZE) {
      break;
    }

    start += ACTIVITIES_PAGE_SIZE;
  }

  return {
    activities: all,
    truncated: all.length >= MAX_ACTIVITIES_FETCH,
  };
}

/**
 * How far back the stored activity table is read when Connect will not answer.
 * Two years covers every window any tool here asks for; the table is small
 * enough that the bound is about intent rather than cost.
 */
const STORED_POOL_DAYS = 730;

export interface ActivityPool {
  activities: ActivitySummary[];
  truncated: boolean;
  /** True when this came out of the local store rather than off the wire. */
  fromStore: boolean;
}

/**
 * Activities are a paged list upstream rather than a per-date fetch, so they do
 * not go through `fetchDaysOrStore`. The rule is the same one: a failed request
 * is not an absence of training. `get_latest_activity` used to answer "No
 * activities found in your Garmin Connect account" whenever the session had
 * expired, which is a statement about the user's life made out of a login
 * error, with 23 activities sitting in the store.
 */
async function fetchActivityPool(): Promise<ActivityPool> {
  try {
    const live = await fetchActivitiesPool();
    return { ...live, fromStore: false };
  } catch (error) {
    logger.info({ err: error }, "Activity fetch failed; answering from the stored history");

    const today = DateTime.local().startOf("day");
    const activities = storedActivitiesBetween(
      today.minus({ days: STORED_POOL_DAYS }).toISODate() ?? "",
      today.toISODate() ?? ""
    );

    return { activities, truncated: false, fromStore: true };
  }
}

export async function getActivitiesPool(): Promise<ActivityPool> {
  const cacheKey = buildToolCacheKey("activities_pool", {});

  return withCache(cacheKey, appConfig.cacheTtlActivities, fetchActivityPool, {
    // A stored pool is cached briefly so a restored connection is picked up,
    // rather than being frozen in for the full activities TTL.
    isPartial: (pool) => pool.fromStore,
  });
}

// SECTION: Tool Handlers

export function renderLatestActivityText(
  payload: LatestActivityPayload,
  units: "metric" | "imperial" = "metric"
): string {
  if (!payload.activity) {
    return payload.fromStore
      ? "Garmin could not be reached just now, and TrainBud's stored history holds no activities either."
      : "No activities found in your Garmin Connect account.";
  }

  const note = payload.fromStore
    ? [
        "Garmin could not be reached just now, so this comes from TrainBud's own stored history.",
        "It is a real activity previously fetched from Connect; anything recorded since is not here yet.",
        "",
        "",
      ].join("\n")
    : "";

  return note + formatActivitySummary(payload.activity, units);
}

export async function getLatestActivity(): Promise<ToolResult<LatestActivityPayload>> {
  const cacheKey = buildToolCacheKey("get_latest_activity", {});

  const latest = await withCache(
    cacheKey,
    appConfig.cacheTtlActivities,
    async () => {
      const { activities, fromStore } = await getActivitiesPool();
      return { activity: activities[0] ?? null, fromStore };
    },
    { isPartial: (value) => value.fromStore }
  );

  const payload: LatestActivityPayload = latest;

  return {
    type: "text",
    text: renderLatestActivityText(payload, getProfile().units),
    data: payload,
  };
}

export function buildActivitiesRangePayload(
  activities: ActivitySummary[],
  startDate: string,
  endDate: string,
  truncated: boolean,
  fromStore = false
): ActivitiesRangePayload {
  return { startDate, endDate, truncated, activities, fromStore };
}

export function renderActivitiesRangeText(
  payload: ActivitiesRangePayload,
  units: "metric" | "imperial" = "metric"
): string {
  const storedNote = payload.fromStore
    ? [
        "Garmin could not be reached just now, so these come from TrainBud's own stored history rather than from Connect.",
        "They are real activities previously fetched; anything recorded since is not here yet.",
        "",
        "",
      ].join("\n")
    : "";

  if (payload.activities.length === 0) {
    return payload.fromStore
      ? `Garmin could not be reached, and TrainBud's stored history holds no activities between ${payload.startDate} and ${payload.endDate}.`
      : `No activities found between ${payload.startDate} and ${payload.endDate}.`;
  }

  const lines = payload.activities.map((activity, index) => {
    const activityDate =
      parseActivityLocalDateTime(activity.startTimeLocal).toISODate() ??
      formatIsoDate(new Date(activity.startTimeLocal));

    return [
      `${index + 1}. ${activity.name} (${activity.type})`,
      `   ${activityDate} | ${formatDistanceMeters(activity.distanceMeters, units)} | ${formatDuration(activity.durationSeconds)}`,
    ].join("\n");
  });

  const warning = payload.truncated
    ? "\n\nNote: Results may be incomplete — only the most recent 500 activities were scanned."
    : "";

  return (
    storedNote +
    [`Found ${payload.activities.length} activities:`, "", ...lines].join("\n") +
    warning
  );
}

export async function getActivitiesRange(
  input: Record<string, unknown>
): Promise<ToolResult<ActivitiesRangePayload>> {
  const start_date = input.start_date as string;
  const end_date = input.end_date as string;
  const { activities: pool, truncated, fromStore } = await getActivitiesPool();

  const payload = buildActivitiesRangePayload(
    filterActivitiesByRange(pool, start_date, end_date),
    start_date,
    end_date,
    truncated,
    fromStore
  );

  return {
    type: "text",
    text: renderActivitiesRangeText(payload, getProfile().units),
    data: payload,
  };
}

export const activityToolDefinitions: ToolDefinition[] = [
  {
    name: "get_latest_activity",
    description: "Returns the most recent Garmin activity with distance, duration, pace, and heart rate stats.",
    inputSchema: {},
    handler: getLatestActivity,
  },
  {
    name: "get_activities_range",
    description: "Returns Garmin activities within an ISO 8601 date range.",
    inputSchema: {
      start_date: {
        type: "string",
        description: "Start date in ISO 8601 format, e.g. 2026-06-01",
      },
      end_date: {
        type: "string",
        description: "End date in ISO 8601 format, e.g. 2026-06-07",
      },
    },
    handler: getActivitiesRange,
  },
];
