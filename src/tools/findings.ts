import { describeFindingsCoverage, runDetectors } from "../detect/index.js";
import type { ToolResult } from "../garmin/types.js";
import type { FindingsPayload } from "./payloads.js";
import type { ToolDefinition } from "./types.js";

// SECTION: Findings tool
//
// The one tool that answers a question Connect cannot: not "what is my resting
// heart rate" but "is anything unusual about it, for me".
//
// It is also the only tool that reads the local store rather than Garmin, which
// makes it the one thing an AI client can still learn about the user when the
// connection is down -- so what it says when `ready` is false matters more here
// than anywhere else in the app.

export function renderFindingsText(payload: FindingsPayload): string {
  // Cold start is a different answer from a clean bill of health, and a record
  // that stops three weeks ago is a third thing again: it has plenty to say and
  // none of it is about this week. Reporting any of the three as another is the
  // failure that matters here.
  if (!payload.coverage.ready) {
    const coverage = describeFindingsCoverage(payload.coverage);
    return [coverage.detail, coverage.fix].filter(Boolean).join("\n");
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
