import { z } from "zod";
import { activityToolDefinitions } from "./activities.js";
import { contextToolDefinitions } from "./context.js";
import { findingsToolDefinitions } from "./findings.js";
import { bodyCompositionToolDefinitions } from "./bodyComposition.js";
import { heartRateToolDefinitions } from "./heartRate.js";
import { recoveryToolDefinitions } from "./recovery.js";
import { sleepToolDefinitions } from "./sleep.js";
import { stressToolDefinitions } from "./stress.js";
import { trainingInsightsToolDefinitions } from "./trainingInsights.js";
import { vo2MaxToolDefinitions } from "./vo2Max.js";
import { weekToolDefinitions } from "./week.js";
import type { ToolDefinition } from "./types.js";
import type { ToolResult } from "../garmin/types.js";
import { parseIsoDate } from "../utils/helpers.js";

// SECTION: Tool Registry

export const toolRegistry: ToolDefinition[] = [
  ...activityToolDefinitions,
  ...sleepToolDefinitions,
  ...heartRateToolDefinitions,
  ...recoveryToolDefinitions,
  ...bodyCompositionToolDefinitions,
  ...stressToolDefinitions,
  ...vo2MaxToolDefinitions,
  ...trainingInsightsToolDefinitions,
  ...findingsToolDefinitions,
  ...weekToolDefinitions,
  ...contextToolDefinitions,
];

const toolHandlers = new Map<string, ToolDefinition["handler"]>(
  toolRegistry.map((tool) => [tool.name, tool.handler])
);

export function getToolByName(name: string): ToolDefinition | undefined {
  return toolRegistry.find((tool) => tool.name === name);
}

export async function executeTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<ToolResult<unknown>> {
  const tool = getToolByName(name);

  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  const input = args ?? {};

  if (name === "get_activities_range") {
    const startDate = input.start_date;
    const endDate = input.end_date;

    if (typeof startDate !== "string" || typeof endDate !== "string") {
      throw new Error("get_activities_range requires start_date and end_date (ISO 8601 strings).");
    }

    parseIsoDate(startDate);
    parseIsoDate(endDate);
  }

  return tool.handler(input);
}

export const toolSchemas = {
  get_latest_activity: z.object({}),
  get_activities_range: z.object({
    start_date: z.string().describe("Start date in ISO 8601 format"),
    end_date: z.string().describe("End date in ISO 8601 format"),
  }),
  get_sleep_data: z.object({
    nights: z.number().int().positive().optional(),
  }),
  get_heart_rate_trends: z.object({
    days: z.number().int().positive().optional(),
  }),
  get_recovery_status: z.object({
    hrv_weight: z.number().positive().optional(),
    sleep_weight: z.number().positive().optional(),
    stress_weight: z.number().positive().optional(),
    resting_hr_weight: z.number().positive().optional(),
  }),
  get_body_composition: z.object({
    days: z.number().int().positive().optional(),
  }),
  get_stress_levels: z.object({
    days: z.number().int().positive().optional(),
  }),
  get_vo2_max_trends: z.object({
    days: z.number().int().positive().optional(),
  }),
  get_training_insights: z.object({
    days: z.number().int().positive().optional(),
  }),
  get_findings: z.object({}),
  get_week_review: z.object({}),
  remember_context: z.object({
    kind: z.enum(["goal", "race", "injury", "note"]).describe("What sort of thing this is"),
    text: z.string().describe("What to remember, in the user's own words where possible"),
    effective_from: z.string().optional().describe("ISO date this became true"),
    effective_to: z.string().optional().describe("ISO date this stops being true"),
  }),
  get_user_context: z.object({
    on_date: z.string().optional().describe("ISO date to evaluate against"),
    include_closed: z.boolean().optional().describe("Include entries that have ended"),
  }),
  log_subjective: z.object({
    kind: z.enum(["rpe", "soreness", "mood"]).describe("Which rating this is"),
    value: z.number().describe("A rating from 1 to 10"),
    date: z.string().optional().describe("ISO date the rating is for"),
    note: z.string().optional().describe("Optional free-text detail"),
  }),
};

export function listRegisteredToolNames(): string[] {
  return Array.from(toolHandlers.keys());
}
