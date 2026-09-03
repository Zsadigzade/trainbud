import { filterActivitiesByRange } from "../utils/helpers.js";
import { DateTime } from "luxon";
import { getActivitiesPool, formatActivitySummary } from "./activities.js";
import { getProfile } from "../profile.js";
import { getSleepDataTool } from "./sleep.js";
import { getRecoveryStatus } from "./recovery.js";
import { getStressLevels } from "./stress.js";
import type { ToolResult } from "../garmin/types.js";
import type { TrainingInsightsPayload } from "./payloads.js";
import type { ToolDefinition } from "./types.js";

/**
 * The sub-tools' rendered text is passed in rather than re-derived here. This
 * tool embeds their output verbatim, so calling three renderers from a fourth
 * would duplicate the composition the handler already does -- and would make
 * this function impure for no gain.
 */
export function renderTrainingInsightsText(
  payload: TrainingInsightsPayload,
  sleepText: string,
  recoveryText: string,
  stressText: string
): string {
  const activityLines =
    payload.activities.length > 0
      ? payload.activities.map((activity, index) => {
          return `${index + 1}. ${activity.name} (${activity.type}) — ${activity.startTimeLocal}`;
        })
      : [`No activities found between ${payload.startDate} and ${payload.endDate}.`];

  return [
    "Training insights summary",
    `Period: ${payload.startDate} to ${payload.endDate}`,
    "",
    "## Latest activity",
    payload.latest ? formatActivitySummary(payload.latest, getProfile().units) : "No activities found.",
    "",
    "## Activities in period",
    ...activityLines,
    "",
    "## Sleep",
    sleepText,
    "",
    "## Recovery",
    recoveryText,
    "",
    "## Stress",
    stressText,
  ].join("\n");
}

export async function getTrainingInsights(
  input: { days?: number }
): Promise<ToolResult<TrainingInsightsPayload>> {
  const days = input.days ?? 7;
  const endDate = DateTime.now().toISODate() ?? "";
  const startDate = DateTime.now().minus({ days }).toISODate() ?? "";

  const { activities: pool } = await getActivitiesPool();
  const ranged = filterActivitiesByRange(pool, startDate, endDate);

  const [sleep, recovery, stress] = await Promise.all([
    getSleepDataTool({ nights: days }),
    getRecoveryStatus({}),
    getStressLevels({ days }),
  ]);

  const payload: TrainingInsightsPayload = {
    startDate,
    endDate,
    latest: pool[0] ?? null,
    activities: ranged,
    sleep: sleep.data ?? null,
    recovery: recovery.data ?? null,
    stress: stress.data ?? null,
  };

  return {
    type: "text",
    text: renderTrainingInsightsText(payload, sleep.text, recovery.text, stress.text),
    data: payload,
  };
}

export const trainingInsightsToolDefinitions: ToolDefinition[] = [
  {
    name: "get_training_insights",
    description:
      "Returns a combined weekly training summary: latest activity, recent workouts, sleep, recovery, and stress.",
    inputSchema: {
      days: {
        type: "number",
        description: "Number of days to summarize. Defaults to 7.",
      },
    },
    handler: getTrainingInsights,
  },
];
