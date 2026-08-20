import Anthropic from "@anthropic-ai/sdk";
import { randomBytes } from "node:crypto";
import { DateTime } from "luxon";
import {
  createPromptJob,
  deleteSetting,
  getPromptJob,
  getSetting,
  listSettingKeys,
  setSetting,
  updatePromptJob,
} from "./appDb.js";
import { appConfig } from "./config.js";
import { buildWatchSummary } from "./watchApi.js";
import { runDetectors, type DetectionResult } from "./detect/index.js";
import { activeContext, type ContextEntry } from "./history/context.js";
import { logger } from "./utils/logger.js";

// SECTION: Prompt API — Claude integration

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 300;
const INSIGHT_PREFIX = "daily_insight:";

/**
 * The dashboard writes the key to the settings table, but the server only
 * copied it into process.env at startup — so a key saved from the dashboard did
 * nothing until the server was restarted. Resolving on every call fixes that.
 * The stored value wins because it is the one the user set most recently
 * through the UI; the environment is the fallback for headless setups.
 */
function resolveAnthropicKey(): string {
  return getSetting("anthropic_api_key") ?? appConfig.anthropicApiKey ?? "";
}

/** True when AI features are usable, from either source. */
export function isAiConfigured(): boolean {
  return resolveAnthropicKey().length > 0;
}

function buildJobId(): string {
  return randomBytes(12).toString("hex");
}

/**
 * What the model is told before it writes a sentence.
 *
 * This used to be four current numbers, which is why the daily insight read
 * like a horoscope: with nothing but today's figures there was nothing to say
 * that the numbers did not already say themselves. Findings refer to things
 * that happened -- a run of days, a deficit against a personal median -- and
 * context says who it is happening to.
 *
 * Cold start is stated explicitly. Handed an empty findings list with no
 * explanation, a model will confidently reassure the user out of no data at all.
 */
export function formatFindingsContext(
  result: DetectionResult,
  context: ContextEntry[]
): string {
  const lines: string[] = [];

  if (!result.coverage.ready) {
    lines.push(
      `Still gathering data: only ${result.coverage.days} days of history are stored, which is not yet enough to compare anything against a baseline. Say so rather than reassuring the user.`
    );
  } else if (result.findings.length === 0) {
    lines.push(
      `Across ${result.coverage.days} days of history, nothing stands out against this user's own baselines.`
    );
  } else {
    lines.push(`What stands out, from ${result.coverage.days} days of history:`);
    for (const finding of result.findings) {
      lines.push(`- [${finding.severity}] ${finding.headline}`);
    }
  }

  if (context.length === 0) {
    lines.push("Nothing on record about this user's goals, races or injuries.");
  } else {
    lines.push("On record about this user:");
    for (const entry of context) {
      lines.push(`- ${entry.kind}: ${entry.text}`);
    }
  }

  return lines.join("\n");
}

function formatHealthContext(summary: Awaited<ReturnType<typeof buildWatchSummary>>): string {
  const lines: string[] = ["Current health snapshot:"];

  if (summary.recovery) {
    lines.push(`- Recovery: ${summary.recovery.score}/100 (${summary.recovery.label})`);
  }
  if (summary.sleep) {
    lines.push(`- Sleep last night: ${summary.sleep.hours}h${summary.sleep.score ? `, score ${summary.sleep.score}` : ""} (${summary.sleep.label})`);
  }
  if (summary.stress) {
    lines.push(`- Avg stress (7d): ${summary.stress.avg} (${summary.stress.label})`);
  }
  if (summary.vo2max) {
    lines.push(`- VO2 Max: ${summary.vo2max.value} (${summary.vo2max.trend})`);
  }
  if (summary.heart_rate) {
    lines.push(`- Resting HR: ${summary.heart_rate.resting} bpm`);
  }
  if (summary.activity) {
    lines.push(`- Last activity: ${summary.activity.name}${summary.activity.duration_min ? `, ${summary.activity.duration_min}min` : ""}${summary.activity.distance_km ? `, ${summary.activity.distance_km}km` : ""}`);
  }

  return lines.join("\n");
}

async function callClaude(prompt: string, healthContext: string): Promise<string> {
  const apiKey = resolveAnthropicKey();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured. Set it in the dashboard or .env file.");
  }

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: `You are a concise fitness coach assistant shown on a small smartwatch screen.
Answer in 2-3 short sentences maximum. Be direct and actionable. No markdown formatting.
Give general training and wellness guidance only. Do not diagnose conditions or give
medical advice; if asked something medical, say it is outside what you can advise on.
${healthContext}`,
    messages: [{ role: "user", content: prompt }],
  });

  const block = message.content[0];
  if (block?.type !== "text") {
    throw new Error("Unexpected response type from Claude");
  }
  return block.text.trim();
}

export interface SubmitPromptResult {
  job_id: string;
}

export function submitPrompt(prompt: string): SubmitPromptResult {
  const id = buildJobId();
  createPromptJob(id, prompt);

  // Fire-and-forget — process asynchronously
  processPromptJob(id, prompt).catch((err) => {
    logger.error({ err, id }, "Prompt job processing failed unexpectedly");
  });

  return { job_id: id };
}

async function processPromptJob(id: string, prompt: string): Promise<void> {
  updatePromptJob(id, { status: "running" });
  try {
    const summary = await buildWatchSummary();
    const detection = runDetectors();
    const context = activeContext(DateTime.local().toISODate() ?? "");

    const healthContext = [
      formatFindingsContext(detection, context),
      "",
      formatHealthContext(summary),
    ].join("\n");

    const result = await callClaude(prompt, healthContext);
    updatePromptJob(id, { status: "done", result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, id }, "Prompt job failed");
    updatePromptJob(id, { status: "error", error: message });
  }
}

export interface PromptJobStatus {
  status: "pending" | "running" | "done" | "error";
  result?: string;
  error?: string;
}

export function getPromptStatus(id: string): PromptJobStatus | null {
  const job = getPromptJob(id);
  if (!job) return null;
  return {
    status: job.status,
    result: job.result ?? undefined,
    error: job.error ?? undefined,
  };
}

/**
 * The daily insight used to be generated inline on every /api/watch request, so
 * a cold fetch blocked the watch for a full Claude round trip and spent API
 * credit on every sync. It is now generated once per local day and cached in the
 * settings table.
 */
export async function generateDailyInsight(
  summary: Awaited<ReturnType<typeof buildWatchSummary>>,
  options: { force?: boolean } = {}
): Promise<string | null> {
  const apiKey = resolveAnthropicKey();
  if (!apiKey) return null;

  const cacheKey = `${INSIGHT_PREFIX}${DateTime.local().toISODate()}`;

  if (!options.force) {
    const cached = getSetting(cacheKey);
    if (cached) return cached;
  }

  try {
    // Both: the findings say what changed, the snapshot says where things stand.
    const detection = runDetectors();
    const context = activeContext(DateTime.local().toISODate() ?? "");

    const healthContext = [
      formatFindingsContext(detection, context),
      "",
      formatHealthContext(summary),
    ].join("\n");

    const result = await callClaude(
      "Give me one sentence of actionable advice for today. Refer to what actually stands out rather than restating the numbers.",
      healthContext
    );
    setSetting(cacheKey, result);
    pruneOldInsights(cacheKey);
    return result;
  } catch (err) {
    logger.warn({ err }, "Daily insight generation failed");
    // Fall back to an earlier insight rather than showing nothing on the watch.
    return getSetting(cacheKey);
  }
}

/** Returns today's cached insight without contacting the API. */
export function getCachedDailyInsight(): string | null {
  return getSetting(`${INSIGHT_PREFIX}${DateTime.local().toISODate()}`);
}

/** Drops today's cached insight so the next request regenerates it. */
export function clearDailyInsight(): void {
  deleteSetting(`${INSIGHT_PREFIX}${DateTime.local().toISODate()}`);
}

function pruneOldInsights(keepKey: string): void {
  for (const key of listSettingKeys(INSIGHT_PREFIX)) {
    if (key !== keepKey) {
      deleteSetting(key);
    }
  }
}
