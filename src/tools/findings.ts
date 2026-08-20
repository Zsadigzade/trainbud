import { runDetectors } from "../detect/index.js";
import type { ToolResult } from "../garmin/types.js";
import type { FindingsPayload } from "./payloads.js";
import type { ToolDefinition } from "./types.js";

// SECTION: Findings tool
//
// The one tool that answers a question Connect cannot: not "what is my resting
// heart rate" but "is anything unusual about it, for me".

export function renderFindingsText(payload: FindingsPayload): string {
  // Cold start is a different answer from a clean bill of health, and reporting
  // the second when the truth is the first is the failure that matters here.
  if (!payload.coverage.ready) {
    return [
      `Still gathering data — ${payload.coverage.days} of the 14 days needed before anything can be compared against a baseline.`,
      "Run `trainbud backfill` to pull what Garmin already holds.",
    ].join("\n");
  }

  if (payload.findings.length === 0) {
    return `Nothing stands out against the user's own baselines, across ${payload.coverage.days} days of history.`;
  }

  return [
    `${payload.findings.length} finding(s) across ${payload.coverage.days} days of history:`,
    "",
    ...payload.findings.map((finding) =>
      [`[${finding.severity}] ${finding.headline}`, `  ${finding.detail}`].join("\n")
    ),
    "",
    "These describe measurements against the user's own baseline. They are not diagnoses.",
  ].join("\n");
}

export async function getFindings(): Promise<ToolResult<FindingsPayload>> {
  const result = runDetectors();
  const payload: FindingsPayload = {
    findings: result.findings,
    coverage: result.coverage,
  };

  return {
    type: "text",
    text: renderFindingsText(payload),
    data: payload,
  };
}

export const findingsToolDefinitions: ToolDefinition[] = [
  {
    name: "get_findings",
    description:
      "Returns what stands out in the user's stored history against their own 28-day baselines: resting heart rate elevation, sleep debt, HRV trend breaks, and training load ratio. Prefer this over reading raw metrics when asked how things are going.",
    inputSchema: {},
    handler: getFindings,
  },
];
