import { DateTime } from "luxon";
import { assertGarminCredentials, appConfig } from "./config.js";
import { executeTool, listRegisteredToolNames } from "./tools/index.js";
import { configureLogger } from "./utils/logger.js";

// SECTION: Live Diagnostics

interface ToolCheckCase {
  name: string;
  args: Record<string, unknown>;
}

interface ToolCheckResult {
  name: string;
  ok: boolean;
  summary: string;
}

function buildDefaultToolChecks(): ToolCheckCase[] {
  const endDate = DateTime.now().toISODate();
  const startDate = DateTime.now().minus({ days: 30 }).toISODate();

  return [
    { name: "get_latest_activity", args: {} },
    {
      name: "get_activities_range",
      args: {
        start_date: startDate,
        end_date: endDate,
      },
    },
    { name: "get_sleep_data", args: { nights: 7 } },
    { name: "get_heart_rate_trends", args: { days: 30 } },
    { name: "get_recovery_status", args: {} },
    { name: "get_body_composition", args: { days: 30 } },
    { name: "get_stress_levels", args: { days: 7 } },
    { name: "get_vo2_max_trends", args: { days: 30 } },
    { name: "get_training_insights", args: { days: 7 } },
  ];
}

function summarizeToolResult(name: string, text: string): { ok: boolean; summary: string } {
  const normalized = text.trim();
  const noDataPattern = /^No .+ found/i;

  if (noDataPattern.test(normalized)) {
    return {
      ok: false,
      summary: normalized.split("\n")[0] ?? normalized,
    };
  }

  if (name === "get_latest_activity") {
    const activityLine = normalized.split("\n").find((line) => line.startsWith("Activity:"));
    const dateLine = normalized.split("\n").find((line) => line.startsWith("Date:"));
    const distanceLine = normalized.split("\n").find((line) => line.startsWith("Distance:"));
    const parts = [activityLine, distanceLine, dateLine].filter(Boolean);
    return {
      ok: true,
      summary: parts.length > 0 ? parts.join(", ") : "Latest activity retrieved",
    };
  }

  if (name === "get_activities_range") {
    const countMatch = normalized.match(/(\d+) activit/i);
    return {
      ok: true,
      summary: countMatch ? `${countMatch[1]} activities found` : "Activities retrieved",
    };
  }

  if (name === "get_sleep_data") {
    const nightsMatch = normalized.match(/(\d+) nights?/i);
    return {
      ok: true,
      summary: nightsMatch ? `${nightsMatch[1]} nights retrieved` : "Sleep data retrieved",
    };
  }

  if (name === "get_heart_rate_trends") {
    const daysMatch = normalized.match(/(\d+) days/i);
    return {
      ok: true,
      summary: daysMatch ? `${daysMatch[1]}-day trend loaded` : "Heart rate trends loaded",
    };
  }

  if (name === "get_recovery_status") {
    const scoreMatch = normalized.match(/Recovery score:\s*(\d+)/i);
    const recommendationMatch = normalized.match(/Recommendation:\s*(.+)/i);
    if (scoreMatch) {
      const recommendation = recommendationMatch?.[1]?.trim();
      return {
        ok: true,
        summary: recommendation
          ? `Score: ${scoreMatch[1]} (${recommendation})`
          : `Score: ${scoreMatch[1]}`,
      };
    }
    return { ok: true, summary: "Recovery status retrieved" };
  }

  if (name === "get_body_composition") {
    const daysMatch = normalized.match(/(\d+) recorded days/i);
    return {
      ok: true,
      summary: daysMatch ? `${daysMatch[1]} recorded days` : "Body composition retrieved",
    };
  }

  if (name === "get_stress_levels") {
    const daysMatch = normalized.match(/(\d+) recorded days/i);
    return {
      ok: true,
      summary: daysMatch ? `${daysMatch[1]} stress days loaded` : "Stress data retrieved",
    };
  }

  if (name === "get_vo2_max_trends") {
    const daysMatch = normalized.match(/(\d+) recorded days/i);
    return {
      ok: true,
      summary: daysMatch ? `${daysMatch[1]} VO2 entries loaded` : "VO2 max trends loaded",
    };
  }

  if (name === "get_training_insights") {
    return {
      ok: true,
      summary: "Training insights summary generated",
    };
  }

  const firstLine = normalized.split("\n")[0] ?? normalized;
  return {
    ok: true,
    summary: firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine,
  };
}

async function runToolCheck(check: ToolCheckCase): Promise<ToolCheckResult> {
  try {
    const result = await executeTool(check.name, check.args);
    const { ok, summary } = summarizeToolResult(check.name, result.text);
    return { name: check.name, ok, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      name: check.name,
      ok: false,
      summary: message,
    };
  }
}

export async function runLiveCheck(): Promise<ToolCheckResult[]> {
  assertGarminCredentials();
  configureLogger(appConfig.logPath);

  const registered = new Set(listRegisteredToolNames());
  const checks = buildDefaultToolChecks().filter((check) => registered.has(check.name));

  const results: ToolCheckResult[] = [];

  for (const check of checks) {
    results.push(await runToolCheck(check));
  }

  return results;
}

export function printLiveCheckResults(results: ToolCheckResult[]): void {
  console.log("TrainBud live check");
  console.log("");

  for (const result of results) {
    const icon = result.ok ? "✓" : "✗";
    const paddedName = result.name.padEnd(26, " ");
    console.log(`  ${paddedName}${icon}  ${result.summary}`);
  }

  console.log("");

  const passed = results.filter((result) => result.ok).length;
  const total = results.length;

  if (passed === total) {
    console.log(`All ${total} checks passed. TrainBud is ready to use.`);
    return;
  }

  console.log(`${passed}/${total} checks passed. Review failures above before connecting an MCP client.`);
}
