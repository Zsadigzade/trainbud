import { describeFindingsCoverage, type DetectionResult } from "./detect/index.js";
import type { Finding, FindingKind } from "./detect/findings.js";
import type { ContextEntry } from "./history/context.js";

// SECTION: Ask prompts
//
// The watch's Ask menu is five hardcoded strings in strings.xml -- "Should I
// train today?", "Am I overtraining?" -- and they would read exactly the same
// on an app with no memory at all. Generated from what actually fired they
// become questions only this app could have known to offer, which makes the
// menu the demo rather than a nicety.
//
// Pure: same input, same five prompts. The watch caches the summary and shows
// them again from storage, so a list that reshuffled would look like the data
// had changed when it had not.

/** Anything longer wraps or clips on a 390 px round screen. */
const MAX_LENGTH = 32;

const PROMPT_COUNT = 5;

const FROM_FINDING: Record<FindingKind, string> = {
  rhr_elevated: "Why is my resting HR up?",
  sleep_debt: "How do I clear sleep debt?",
  hrv_trend_break: "Why is my HRV dropping?",
  load_ratio_high: "Am I ramping up too fast?",
  load_ratio_low: "Have I lost fitness?",
};

/**
 * Ordered by how often they are worth asking with nothing else to go on. These
 * fill the menu out; they never displace a question raised by real data.
 */
const GENERIC = [
  "Should I train today?",
  "How is my recovery?",
  "Summarize my week",
  "How is my sleep trending?",
  "What should I focus on?",
];

const COLD_START = [
  "How much data do you have?",
  "What can you tell me yet?",
  "Should I train today?",
  "How is my recovery?",
  "Summarize my week",
];

/**
 * A store with months in it that stopped three weeks ago is not a cold start,
 * and offering "What can you tell me yet?" to someone with 74 days of history
 * misdescribes their own data back to them. The useful questions here are about
 * the record itself and about the period it does cover -- both of which this app
 * can answer perfectly well without a single live request.
 */
const STALE = [
  "Why is my data out of date?",
  "How was my last month?",
  "How is my sleep trending?",
  "Have I lost fitness?",
  "What should I focus on?",
];

function contextPrompt(entries: ContextEntry[]): string | null {
  const race = entries.find((entry) => entry.kind === "race");
  if (race) {
    return "How is my race prep going?";
  }

  const injury = entries.find((entry) => entry.kind === "injury");
  if (injury) {
    return "Is my injury affecting this?";
  }

  const goal = entries.find((entry) => entry.kind === "goal");
  if (goal) {
    return "Am I on track for my goal?";
  }

  return null;
}

function fill(seed: string[], pool: string[]): string[] {
  const chosen = [...seed];

  for (const candidate of pool) {
    if (chosen.length >= PROMPT_COUNT) {
      break;
    }
    if (!chosen.includes(candidate)) {
      chosen.push(candidate);
    }
  }

  return chosen.slice(0, PROMPT_COUNT);
}

/**
 * Always exactly five. The watch lays out a fixed menu and a short list would
 * leave it rendering stale entries from its cache.
 */
export function buildPromptSuggestions(
  result: DetectionResult,
  context: ContextEntry[] = []
): string[] {
  if (!result.coverage.ready) {
    return describeFindingsCoverage(result.coverage).state === "stale"
      ? [...STALE]
      : [...COLD_START];
  }

  const fromFindings = result.findings
    .map((finding: Finding) => FROM_FINDING[finding.kind])
    .filter((prompt): prompt is string => typeof prompt === "string");

  const seed: string[] = [];
  for (const prompt of fromFindings) {
    if (!seed.includes(prompt)) {
      seed.push(prompt);
    }
  }

  const fromContext = contextPrompt(context);
  if (fromContext && !seed.includes(fromContext)) {
    seed.push(fromContext);
  }

  return fill(seed, GENERIC);
}

/** Exported for the test that keeps every prompt inside the watch's width. */
export const PROMPT_MAX_LENGTH = MAX_LENGTH;
