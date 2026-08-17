import fs from "node:fs";
import { DateTime } from "luxon";
import { assertGarminCredentials, appConfig, deprecatedEnvNames, getEnvFilePath } from "./config.js";
import { executeTool, listRegisteredToolNames } from "./tools/index.js";
import { configureLogger } from "./utils/logger.js";
import { getDataDir, getLegacyDataDir } from "./paths.js";

// SECTION: Live Diagnostics

interface ToolCheckCase {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolCheckResult {
  name: string;
  ok: boolean;
  summary: string;
  /** Non-fatal findings are reported but do not fail the command. */
  warning?: boolean;
  section?: string;
}

// -----------------------------------------------------------------------------
// Setup checks
//
// The tool checks below only prove the Connect API works. They say nothing about
// the parts that actually strand people: no API key, no public URL, state left
// in the pre-rename directory. Those are checked first so `trainbud check`
// diagnoses the whole stack rather than one layer of it.
// -----------------------------------------------------------------------------

function checkSetup(): ToolCheckResult[] {
  const results: ToolCheckResult[] = [];
  const add = (name: string, ok: boolean, summary: string, warning = false): void => {
    results.push({ name, ok, summary, warning, section: "Setup" });
  };

  const envPath = getEnvFilePath();
  add(".env file", fs.existsSync(envPath), fs.existsSync(envPath) ? envPath : `missing — run "trainbud setup"`);

  const hasCredentials = !!appConfig.garminEmail && !!appConfig.garminPassword;
  add(
    "Connect credentials",
    hasCredentials,
    hasCredentials ? appConfig.garminEmail : "GARMIN_EMAIL / GARMIN_PASSWORD not set"
  );

  const hasApiKey = appConfig.mcpApiKey.length > 0;
  add(
    "API key",
    hasApiKey,
    hasApiKey ? `set (${appConfig.mcpApiKey.length} chars)` : `TRAINBUD_API_KEY not set — run "trainbud setup"`
  );

  const dataDir = getDataDir();
  let writable: boolean;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.accessSync(dataDir, fs.constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }
  add("Data directory", writable, writable ? dataDir : `not writable: ${dataDir}`);

  const legacyDir = getLegacyDataDir();
  const legacyPresent = fs.existsSync(legacyDir);
  add(
    "Legacy directory",
    true,
    legacyPresent
      ? `${legacyDir} still present — safe to delete once everything works`
      : "none",
    legacyPresent
  );

  const deprecated = deprecatedEnvNames();
  add(
    "Env var names",
    true,
    deprecated.length > 0 ? `using old names: ${deprecated.join(", ")}` : "current",
    deprecated.length > 0
  );

  const publicUrl = appConfig.publicUrl;
  add(
    "Public URL",
    true,
    publicUrl.length > 0 ? publicUrl : "not set — the watch cannot reach this server without it",
    publicUrl.length === 0
  );

  const aiKey = appConfig.anthropicApiKey.length > 0;
  add("AI features", true, aiKey ? "key present" : "no key — AI cards stay empty (optional)", !aiKey);

  return results;
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
  const results: ToolCheckResult[] = checkSetup();

  // Without credentials the tool checks can only fail, and their errors would
  // bury the setup finding that actually explains why.
  if (!appConfig.garminEmail || !appConfig.garminPassword) {
    return results;
  }

  assertGarminCredentials();
  configureLogger(appConfig.logPath);

  const registered = new Set(listRegisteredToolNames());
  const checks = buildDefaultToolChecks().filter((check) => registered.has(check.name));

  for (const check of checks) {
    const result = await runToolCheck(check);
    results.push({ ...result, section: "Tools" });
  }

  return results;
}

export function printLiveCheckResults(results: ToolCheckResult[]): void {
  console.log("TrainBud check");

  let currentSection = "";
  for (const result of results) {
    const section = result.section ?? "Checks";
    if (section !== currentSection) {
      console.log("");
      console.log(`${section}`);
      currentSection = section;
    }

    const icon = !result.ok ? "✗" : result.warning ? "!" : "✓";
    console.log(`  ${result.name.padEnd(26, " ")}${icon}  ${result.summary}`);
  }

  console.log("");

  const failed = results.filter((result) => !result.ok);
  const warned = results.filter((result) => result.ok && result.warning);
  const total = results.length;

  if (failed.length === 0 && warned.length === 0) {
    console.log(`All ${total} checks passed. TrainBud is ready to use.`);
    return;
  }

  if (failed.length === 0) {
    console.log(
      `${total - warned.length}/${total} clean, ${warned.length} advisory (!). Nothing is broken — the notes above are optional setup.`
    );
    return;
  }

  console.log(`${total - failed.length}/${total} passed, ${failed.length} failed (✗). Fix those first:`);
  for (const result of failed) {
    console.log(`  - ${result.name}: ${result.summary}`);
  }
}
