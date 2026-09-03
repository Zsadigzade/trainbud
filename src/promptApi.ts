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

// The cheapest current model, which is the right default for this product: the
// answers are two or three sentences read on a watch, and the user pays for
// every one of them out of their own key. Unversioned id on purpose -- the
// dated form is a pinned snapshot, and current SDK guidance is that the plain
// id is complete as written.
const MODEL = "claude-haiku-4-5";
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

  if (result.coverage.days > 0 && result.coverage.staleDays > 3) {
    // The record has plenty of days and stops weeks ago. Saying "nothing stands
    // out" here is a claim about days that were never recorded, and it is the
    // single most misleading thing this prompt can contain: the model repeats it
    // as reassurance.
    lines.push(
      `The stored record has ${result.coverage.days} days but ENDS ON ${result.coverage.throughDate}, which is ${result.coverage.staleDays} days ago. Nothing is known about the days since. Do not reassure the user that things look fine, and do not describe today: say the record is out of date and that running \`trainbud backfill\` will bring it current.`
    );
  } else if (!result.coverage.ready) {
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

export function formatHealthContext(summary: Awaited<ReturnType<typeof buildWatchSummary>>): string {
  const lines: string[] = [];

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

  // The week and the calendar, which change what today's numbers mean.
  //
  // Without these the model answers every question as though the user exists
  // only today: a falling load ratio reads as detraining even when it is a
  // deliberate taper, and "should I train today" gets the same answer three
  // days before a race as it does in January. Both facts are in the store and
  // neither was ever passed to the model.
  if (summary.week && summary.week.ready) {
    const week = summary.week;
    const parts = [`${week.sessions} session(s) this week vs ${week.previous_sessions} last week`];
    if (week.load_delta_pct !== null) {
      parts.push(`training load ${week.load_delta_pct >= 0 ? "up" : "down"} ${Math.abs(week.load_delta_pct)}%`);
    }
    if (week.forecast_verdict !== "unknown" && week.forecast_ratio !== null) {
      parts.push(
        `if this week repeats, the acute:chronic load ratio lands at ${week.forecast_ratio} (${week.forecast_verdict.replace(/_/g, " ")})`
      );
    }
    if (week.sleep_debt_h !== null && Math.abs(week.sleep_debt_h) >= 1) {
      parts.push(
        `${Math.abs(week.sleep_debt_h)}h of sleep ${week.sleep_debt_h > 0 ? "debt" : "surplus"} against their own usual night`
      );
    }
    if (week.sleep_consistency !== "unknown" && week.sleep_consistency !== "steady") {
      parts.push(`sleep timing is ${week.sleep_consistency}`);
    }
    lines.push(`- This week: ${parts.join("; ")}.`);
  }

  if (summary.race) {
    lines.push(
      `- Next race: ${summary.race.text} in ${summary.race.days_away} day(s). Training phase: ${summary.race.phase.replace(/_/g, " ")}. A falling load in a taper is intended, not a lapse.`
    );
  }

  // An empty section headed "Current health snapshot:" is worse than no section.
  //
  // Every field above comes from a live Garmin call, and when that call fails --
  // an expired session, a rate limit, no network -- all of them are null. The
  // header was printed unconditionally, so the model received a heading with
  // nothing under it and correctly concluded it had been given no data about the
  // user. What the user then reads is "the AI cannot see my data", which is true,
  // and infers "the app is broken", which is a different thing from "Garmin did
  // not answer just now".
  //
  // Say which it is, and point the model at the stored history above, which is
  // real and still worth reasoning about.
  if (lines.length === 0) {
    return [
      "No live metrics are available right now: the request to Garmin did not return today's figures. This is a connection problem, not an absence of data about this user.",
      "Say that today's numbers could not be fetched, then answer from the stored history above if it supports an answer. Never invent current values, and do not tell the user you have no access to their data.",
    ].join("\n");
  }

  return ["Current health snapshot:", ...lines].join("\n");
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
