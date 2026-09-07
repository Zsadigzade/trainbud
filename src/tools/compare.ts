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
  /** Earlier workouts of the same sport, before the distance filter. */
  earlierSameType: number;
  /** The nearest of those by scale, comparable or not. */
  nearest: StoredActivity | null;
  metrics: WorkoutComparison["metrics"] | null;
}

function startedEarlier(candidate: StoredActivity, subject: StoredActivity): boolean {
  if (candidate.date !== subject.date) {
    return candidate.date < subject.date;
  }
  return candidate.startTimeLocal < subject.startTimeLocal;
}

function earlierOfSameType(subject: StoredActivity, pool: StoredActivity[]): StoredActivity[] {
  return pool.filter(
    (candidate) =>
      candidate.activityId !== subject.activityId &&
      candidate.type === subject.type &&
      startedEarlier(candidate, subject)
  );
}

function scaleValue(activity: StoredActivity): number | null {
  if (typeof activity.distanceMeters === "number" && activity.distanceMeters > 0) {
    return activity.distanceMeters;
  }
  if (typeof activity.durationSeconds === "number" && activity.durationSeconds > 0) {
    return activity.durationSeconds;
  }
  return null;
}

/** The closest earlier effort by scale, however far away it turns out to be. */
function nearestByScale(
  subject: StoredActivity,
  earlier: StoredActivity[]
): StoredActivity | null {
  const target = scaleValue(subject);
  if (target === null) {
    return earlier[0] ?? null;
  }

  const measured = earlier.filter((candidate) => scaleValue(candidate) !== null);
  if (measured.length === 0) {
    return null;
  }

  return measured.reduce((best, candidate) =>
    Math.abs(scaleValue(candidate)! - target) < Math.abs(scaleValue(best)! - target)
      ? candidate
      : best
  );
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
      data: {
        subject: null,
        closest: null,
        comparableCount: 0,
        earlierSameType: 0,
        nearest: null,
        metrics: null,
      },
    };
  }

  const comparables = findComparableWorkouts(subject, pool, args.limit);

  // Kept even when nothing is comparable: "you have nine earlier runs, none at
  // this distance" is a different answer from "this is your first run", and the
  // renderer cannot tell them apart without this.
  const earlier = earlierOfSameType(subject, pool);
  const comparison = compareWorkouts(subject, comparables, {
    earlierSameType: earlier.length,
    nearest: nearestByScale(subject, earlier),
  });

  return {
    type: "text",
    text: renderWorkoutComparison(comparison, getProfile().units),
    data: {
      subject: comparison.subject,
      closest: comparison.closest,
      comparableCount: comparison.comparableCount,
      earlierSameType: comparison.earlierSameType,
      nearest: comparison.nearest,
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
