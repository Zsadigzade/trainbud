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

/**
 * The user's questions, reduced to what the menu can actually show.
 *
 * `profile.ts` refuses a blank, an over-wide or a sixth question on write, so
 * in practice nothing is dropped here. It is done anyway because the watch
 * payload must not depend on when a stored row happened to be written: this
 * field existed in the schema from 0.5.0 with nothing reading or validating it,
 * and a row saved by hand or by an older build still has to render.
 */
function usableCustom(custom: readonly string[]): string[] {
  const chosen: string[] = [];

  for (const raw of custom) {
    const prompt = raw.trim();
    if (!prompt || prompt.length > MAX_LENGTH || chosen.includes(prompt)) {
      continue;
    }
    chosen.push(prompt);
    if (chosen.length >= PROMPT_COUNT) {
      break;
    }
  }

  return chosen;
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
  context: ContextEntry[] = [],
  custom: readonly string[] = []
): string[] {
  // The user's own questions lead, in every state. A question someone took the
  // trouble to write is a better use of one of five slots than one this file
  // guessed -- and on a cold start it is the only question here that is not
  // about data the app does not have yet.
  const own = usableCustom(custom);

  if (!result.coverage.ready) {
    return fill(
      own,
      describeFindingsCoverage(result.coverage).state === "stale" ? STALE : COLD_START
    );
  }

  const fromFindings = result.findings
    .map((finding: Finding) => FROM_FINDING[finding.kind])
    .filter((prompt): prompt is string => typeof prompt === "string");

  const seed: string[] = [...own];
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

/**
 * Exported for the test that keeps every prompt inside the watch's width, and
 * for the profile schema, which refuses to store a question the menu could
 * never show. This file owns both numbers: the menu is what they describe.
 */
export const PROMPT_MAX_LENGTH = MAX_LENGTH;

/** How many the watch draws. Also the cap on how many the user may write. */
export const PROMPT_SLOTS = PROMPT_COUNT;
