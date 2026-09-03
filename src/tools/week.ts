import { DateTime } from "luxon";
import { buildDetectorInput } from "../detect/index.js";
import { buildWeekReview, type WeekReview } from "../detect/week.js";
import { nextRace, describeRace, type RaceCountdown } from "../detect/countdown.js";
import { activeContext, upcomingContext } from "../history/context.js";
import type { ToolResult } from "../garmin/types.js";
import type { ToolDefinition } from "./types.js";

// SECTION: Week review tool
//
// get_findings answers "is anything unusual today". This answers the question
// training is actually planned in: how did the week go, against the week before
// it, and where does the load land if next week looks like this one.
//
// Every number here comes from the store rather than from a model. The model's
// only job in this project is to phrase what code has already decided -- a
// language model asked to spot a trend will phrase a hallucinated one exactly
// as confidently as a real one, and this codebase's entire bug history is
// numbers being quietly wrong.

export interface WeekPayload {
  review: WeekReview;
  race: RaceCountdown | null;
}

function formatMetric(metric: WeekReview["metrics"][number]): string {
  if (metric.current === null) {
    return `${metric.label}: not recorded this week`;
  }

  const unit = metric.unit ? metric.unit : "";
  const current = `${metric.current}${unit}`;

  if (metric.previous === null) {
    return `${metric.label}: ${current} (no comparable week before it)`;
  }

  const delta = metric.delta ?? 0;
  const sign = delta > 0 ? "+" : "";
  return `${metric.label}: ${current} vs ${metric.previous}${unit} (${sign}${delta}${unit})`;
}

export function renderWeekText(payload: WeekPayload): string {
  const { review, race } = payload;

  if (!review.ready) {
    return [
      review.headline,
      "Run `trainbud backfill` to pull what Garmin already holds.",
    ].join("\n");
  }

  const lines: string[] = [
    `Week of ${review.start} to ${review.end}`,
    "",
    review.headline,
    "",
    `Sessions: ${review.sessions} (${review.movingMinutes} min) vs ${review.previousSessions} (${review.previousMovingMinutes} min) last week`,
    "",
    ...review.metrics.map(formatMetric),
  ];

  if (review.forecast.verdict !== "unknown") {
    lines.push("", `Next week: ${review.forecast.summary}`);
    if (review.forecast.weeklyLoadAdjustment !== null) {
      const adjustment = review.forecast.weeklyLoadAdjustment;
      lines.push(
        adjustment < 0
          ? `To stay inside the band, this week's load would need to come down by about ${Math.abs(adjustment)} TRIMP.`
          : `To stay inside the band, this week's load would need to come up by about ${adjustment} TRIMP.`
      );
    }
  }

  if (review.sleep.habitualHours !== null) {
    lines.push("", `Sleep: ${review.sleep.summary}`);
  }

  const raceLine = describeRace(race);
  if (raceLine) {
    lines.push("", raceLine);
  }

  lines.push(
    "",
    "These are measurements against the user's own baselines, not diagnoses."
  );

  return lines.join("\n");
}

export async function getWeekReview(): Promise<ToolResult<WeekPayload>> {
  const today = DateTime.local().toISODate() ?? "";
  const review = buildWeekReview(buildDetectorInput());
  const race = nextRace([...activeContext(today), ...upcomingContext(today)], today);

  const payload: WeekPayload = { review, race };

  return {
    type: "text",
    text: renderWeekText(payload),
    data: payload,
  };
}

export const weekToolDefinitions: ToolDefinition[] = [
  {
    name: "get_week_review",
    description:
      "Returns this training week against the previous one — sessions, training load, sleep, resting heart rate, HRV and stress — plus where the acute:chronic load ratio lands if next week repeats this one, a sleep debt and consistency read against the user's own baseline, and the next race on record. Prefer this over reading individual metrics when asked how the week or the block is going, whether to back off, or what to do next week.",
    inputSchema: {},
    handler: getWeekReview,
  },
];
