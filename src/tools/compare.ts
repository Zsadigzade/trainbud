import {
  compareWorkouts,
  findComparableWorkouts,
  renderWorkoutComparison,
  type WorkoutComparison,
} from "../detect/compare.js";
import { getActivitiesBetween, type StoredActivity } from "../history/store.js";
import type { ToolResult } from "../garmin/types.js";
import type { ToolDefinition } from "./types.js";
import { getProfile } from "../profile.js";

// SECTION: Workout comparison
//
// Answers "how did that one go, for me" -- the question a single activity
// summary cannot, because a 25 minute 5k means nothing without the other times
// this person ran 5k.
//
// Reads the local store rather than Garmin, like get_findings, so it keeps
// working with the connection down. The arithmetic lives in detect/compare.ts;
// this file only decides which workouts go into it.

// The store holds whatever has been backfilled; there is no reason to bound the
// window, and a fixed one would quietly stop finding last season's races.
const EARLIEST_DATE = "1900-01-01";
const LATEST_DATE = "2999-12-31";

export interface WorkoutComparisonPayload {
  subject: StoredActivity | null;
  closest: StoredActivity | null;
  comparableCount: number;
  metrics: WorkoutComparison["metrics"] | null;
}

function mostRecent(activities: StoredActivity[]): StoredActivity | null {
  return (
    [...activities].sort((left, right) =>
      right.startTimeLocal.localeCompare(left.startTimeLocal)
    )[0] ?? null
  );
}

export async function compareWorkoutsTool(
  args: { activity_id?: number; limit?: number } = {}
): Promise<ToolResult<WorkoutComparisonPayload>> {
  const pool = getActivitiesBetween(EARLIEST_DATE, LATEST_DATE);

  const subject =
    typeof args.activity_id === "number"
      ? (pool.find((activity) => activity.activityId === args.activity_id) ?? null)
      : mostRecent(pool);

  if (!subject) {
    const text =
      typeof args.activity_id === "number"
        ? `No stored activity with id ${args.activity_id}. Run "trainbud backfill" if it is older than your stored history.`
        : "No activities found in the local store yet. Run \"trainbud backfill\" to fetch your history.";

    return {
      type: "text",
      text,
      data: { subject: null, closest: null, comparableCount: 0, metrics: null },
    };
  }

  const comparables = findComparableWorkouts(subject, pool, args.limit);
  const comparison = compareWorkouts(subject, comparables);

  return {
    type: "text",
    text: renderWorkoutComparison(comparison, getProfile().units),
    data: {
      subject: comparison.subject,
      closest: comparison.closest,
      comparableCount: comparison.comparableCount,
      metrics: comparison.metrics,
    },
  };
}

export const compareToolDefinitions: ToolDefinition[] = [
  {
    name: "compare_workouts",
    description:
      "Compares one workout against the user's own earlier workouts of the same type and a similar distance (or duration, for sports that record no distance). Reports duration, pace, heart rate, elevation and calories against the closest previous effort, with the typical value across the comparable set. Defaults to the most recent activity. Use this when asked how a session went compared with usual, rather than reading a single activity summary.",
    inputSchema: {
      activity_id: {
        type: "number",
        description: "Which stored activity to compare. Defaults to the most recent one.",
      },
      limit: {
        type: "number",
        description: "How many comparable earlier workouts to consider. Defaults to 5.",
      },
    },
    handler: compareWorkoutsTool,
  },
];
