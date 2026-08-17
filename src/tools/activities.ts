import type { IActivity } from "../garmin/garminApiTypes.js";
import { appConfig } from "../config.js";
import { buildToolCacheKey, withCache } from "../garmin/cache.js";
import { withGarminClient } from "../garmin/client.js";
import type { ActivitySummary, ToolTextResult } from "../garmin/types.js";
import type { ToolDefinition } from "./types.js";
import {
  filterActivitiesByRange,
  formatDistanceMeters,
  formatDuration,
  formatIsoDate,
  formatPaceMetersPerSecond,
  parseActivityLocalDateTime,
} from "../utils/helpers.js";

const ACTIVITIES_PAGE_SIZE = 100;
const MAX_ACTIVITIES_FETCH = 500;

// SECTION: Activity Mapping

function mapActivity(activity: IActivity): ActivitySummary {
  return {
    activityId: activity.activityId,
    name: activity.activityName,
    type: activity.activityType.typeKey,
    startTimeLocal: activity.startTimeLocal,
    distanceMeters: activity.distance ?? null,
    durationSeconds: activity.duration ?? null,
    averageHeartRate: activity.averageHR ?? null,
    maxHeartRate: activity.maxHR ?? null,
    elevationGainMeters: activity.elevationGain ?? null,
    calories: activity.calories ?? null,
    averageSpeedMps: activity.averageSpeed ?? null,
  };
}

export function formatActivitySummary(activity: ActivitySummary): string {
  return [
    `Activity: ${activity.name}`,
    `Type: ${activity.type}`,
    `Date: ${activity.startTimeLocal}`,
    `Distance: ${formatDistanceMeters(activity.distanceMeters)}`,
    `Duration: ${formatDuration(activity.durationSeconds)}`,
    `Pace: ${formatPaceMetersPerSecond(activity.averageSpeedMps)}`,
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

export async function getActivitiesPool(): Promise<{ activities: ActivitySummary[]; truncated: boolean }> {
  const cacheKey = buildToolCacheKey("activities_pool", {});

  return withCache(cacheKey, appConfig.cacheTtlActivities, fetchActivitiesPool);
}

// SECTION: Tool Handlers

export async function getLatestActivity(): Promise<ToolTextResult> {
  const cacheKey = buildToolCacheKey("get_latest_activity", {});

  const activity = await withCache(cacheKey, appConfig.cacheTtlActivities, async () => {
    const { activities } = await getActivitiesPool();
    return activities[0] ?? null;
  });

  if (!activity) {
    return {
      type: "text",
      text: "No activities found in your Garmin Connect account.",
    };
  }

  return {
    type: "text",
    text: formatActivitySummary(activity),
  };
}

export async function getActivitiesRange(input: Record<string, unknown>): Promise<ToolTextResult> {
  const start_date = input.start_date as string;
  const end_date = input.end_date as string;
  const { activities: pool, truncated } = await getActivitiesPool();
  const activities = filterActivitiesByRange(pool, start_date, end_date);

  if (activities.length === 0) {
    return {
      type: "text",
      text: `No activities found between ${start_date} and ${end_date}.`,
    };
  }

  const lines = activities.map((activity, index) => {
    const activityDate =
      parseActivityLocalDateTime(activity.startTimeLocal).toISODate() ??
      formatIsoDate(new Date(activity.startTimeLocal));

    return [
      `${index + 1}. ${activity.name} (${activity.type})`,
      `   ${activityDate} | ${formatDistanceMeters(activity.distanceMeters)} | ${formatDuration(activity.durationSeconds)}`,
    ].join("\n");
  });

  const warning = truncated
    ? "\n\nNote: Results may be incomplete — only the most recent 500 activities were scanned."
    : "";

  return {
    type: "text",
    text: [`Found ${activities.length} activities:`, "", ...lines].join("\n") + warning,
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
