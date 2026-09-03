import { median } from "./baseline.js";
import type { DetectorInput } from "./findings.js";

// SECTION: Sleep debt and consistency
//
// The Sleep card shows last night. Last night is the least informative sleep
// number there is: everyone has a bad night, and a single figure cannot tell a
// late film from a fortnight of five-hour nights.
//
// Two things it cannot say and this can:
//
//   * DEBT -- how far the last week sits under what this person actually
//     sleeps. Against their own median, not against eight hours. Eight hours is
//     a population figure and telling a habitual seven-hour sleeper they are an
//     hour down every night of their life is how a health app becomes noise.
//
//   * CONSISTENCY -- how much the nights vary. Regularity predicts how rested
//     someone is well beyond duration, and it is invisible in any single night.
//     Measured as median absolute deviation rather than standard deviation, for
//     the same reason every baseline here does: one 11-hour recovery sleep
//     after a race would inflate a standard deviation and make a metronomic
//     sleeper look erratic.
//
// Neither number is a diagnosis and neither mentions one.

const NEED_WINDOW_DAYS = 28;
const DEBT_WINDOW_DAYS = 7;
const CONSISTENCY_WINDOW_DAYS = 14;

/** Below this the figures describe a fortnight's mood rather than a person. */
const MIN_NIGHTS_FOR_NEED = 14;
const MIN_NIGHTS_FOR_CONSISTENCY = 7;

export type SleepConsistency = "steady" | "variable" | "erratic" | "unknown";

export interface SleepQuality {
  /** This person's own habitual nightly sleep, in hours. */
  habitualHours: number | null;
  /** Hours slept last night, or null if it was not recorded. */
  lastNightHours: number | null;
  /**
   * Net hours under habitual across the last seven nights. Positive is a debt;
   * negative means they slept more than usual. Null without a habitual figure.
   */
  debtHours: number | null;
  /** Nights that actually carry a measurement in the debt window. */
  nightsCounted: number;
  /** Typical night-to-night swing, in minutes. */
  variationMinutes: number | null;
  consistency: SleepConsistency;
  summary: string;
}

const SECONDS_PER_HOUR = 3600;

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Bands are in minutes of typical swing. Half an hour either side of your own
 * median is an ordinary life; two hours is a different sleep pattern every
 * night, and that is worth naming even when the total is fine -- which is
 * exactly the case a duration-only card cannot see.
 */
function bandFor(variationMinutes: number): SleepConsistency {
  if (variationMinutes <= 30) {
    return "steady";
  }
  return variationMinutes <= 60 ? "variable" : "erratic";
}

export function analyseSleep(input: DetectorInput): SleepQuality {
  const window = input.series("sleep_seconds", NEED_WINDOW_DAYS);
  const hours = window.map((point) => point.value / SECONDS_PER_HOUR);

  const empty: SleepQuality = {
    habitualHours: null,
    lastNightHours: null,
    debtHours: null,
    nightsCounted: 0,
    variationMinutes: null,
    consistency: "unknown",
    summary: "Not enough nights recorded yet to describe your sleep pattern.",
  };

  if (hours.length === 0) {
    return empty;
  }

  const lastNightHours = round(hours[hours.length - 1] ?? 0);

  if (hours.length < MIN_NIGHTS_FOR_NEED) {
    return {
      ...empty,
      lastNightHours,
      nightsCounted: hours.length,
      summary: `Only ${hours.length} nights recorded so far; ${MIN_NIGHTS_FOR_NEED} are needed before a personal baseline means anything.`,
    };
  }

  const habitual = median(hours);
  if (habitual === null) {
    return { ...empty, lastNightHours, nightsCounted: hours.length };
  }

  const debtWindow = hours.slice(-DEBT_WINDOW_DAYS);
  const debt = debtWindow.reduce((total, night) => total + (habitual - night), 0);

  const consistencyWindow = hours.slice(-CONSISTENCY_WINDOW_DAYS);
  let variationMinutes: number | null = null;
  let consistency: SleepConsistency = "unknown";

  if (consistencyWindow.length >= MIN_NIGHTS_FOR_CONSISTENCY) {
    const centre = median(consistencyWindow);
    if (centre !== null) {
      const deviations = consistencyWindow.map((night) => Math.abs(night - centre));
      const mad = median(deviations);
      if (mad !== null) {
        variationMinutes = Math.round(mad * 60);
        consistency = bandFor(variationMinutes);
      }
    }
  }

  const habitualHours = round(habitual);
  const debtHours = round(debt);

  const debtSentence =
    debtHours >= 1
      ? `You are ${debtHours}h under your own usual ${habitualHours}h across the last ${debtWindow.length} nights.`
      : debtHours <= -1
        ? `You are ${round(-debtHours)}h above your own usual ${habitualHours}h across the last ${debtWindow.length} nights.`
        : `The last ${debtWindow.length} nights are close to your usual ${habitualHours}h.`;

  const consistencySentence =
    consistency === "unknown"
      ? ""
      : consistency === "steady"
        ? ` Your nights are steady, within about ${variationMinutes} minutes of each other.`
        : ` Your nights swing by about ${variationMinutes} minutes, which is ${consistency === "erratic" ? "a different pattern most nights" : "more variable than steady"}.`;

  return {
    habitualHours,
    lastNightHours,
    debtHours,
    nightsCounted: debtWindow.length,
    variationMinutes,
    consistency,
    summary: debtSentence + consistencySentence,
  };
}
