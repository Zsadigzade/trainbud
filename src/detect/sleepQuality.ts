import { DateTime } from "luxon";
import { median } from "./baseline.js";
import type { DetectorInput } from "./findings.js";
import type { MetricPoint } from "../history/store.js";

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

/**
 * How old the newest row may be and still be called "last night".
 *
 * One day: a watch that has not been synced since this morning is ordinary. Two
 * weeks is not, and the store's newest row was being reported as last night
 * however old it was.
 */
const LAST_NIGHT_GRACE_DAYS = 1;
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

/**
 * Nights inside the last `days` calendar days, newest last.
 *
 * NOT `slice(-days)`. Seven array positions are seven nights only when the
 * store has no holes, and it routinely does -- a night gets a row only when the
 * watch was worn. `split()` in detectors.ts carries a long comment about
 * exactly this fault, written after a resting heart rate elevated in June was
 * reported as "3 days running" in August. The same slice survived here, and on
 * the live store, whose record ends 2026-08-21, this file reported that night
 * as "last night" on 2026-09-03 and computed a debt over 08-15..08-21 while
 * calling it "the last 7 nights".
 */
function withinDays(points: MetricPoint[], days: number, now: DateTime): MetricPoint[] {
  const cutoff = now.startOf("day").minus({ days }).toISODate() ?? "";
  return points.filter((point) => point.date > cutoff);
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

  // "Last night" is a claim about last night. The newest row in the store is
  // only that if it is dated last night; grace of one day for a watch that has
  // not synced yet, and nothing beyond.
  const newest = window.at(-1);
  const newestAge =
    newest === undefined
      ? null
      : Math.round(
          input.now.startOf("day").diff(DateTime.fromISO(newest.date).startOf("day"), "days").days
        );
  const lastNightHours =
    newest !== undefined && newestAge !== null && newestAge <= LAST_NIGHT_GRACE_DAYS
      ? round(newest.value / SECONDS_PER_HOUR)
      : null;

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

  const debtNights = withinDays(window, DEBT_WINDOW_DAYS, input.now);

  // A week with nothing recorded in it has no deficit; it has no week. Stating
  // a debt of zero here would read as "you slept exactly your usual amount",
  // which is the absence-rendered-as-a-measurement fault this file's own
  // neighbours were fixed for.
  if (debtNights.length === 0) {
    return {
      ...empty,
      habitualHours: round(habitual),
      lastNightHours,
      summary: `No nights recorded in the last ${DEBT_WINDOW_DAYS} days, so there is nothing to compare against your usual ${round(habitual)}h. The record stops at ${newest?.date ?? "an earlier date"}.`,
    };
  }

  const debtWindow = debtNights.map((point) => point.value / SECONDS_PER_HOUR);
  const debt = debtWindow.reduce((total, night) => total + (habitual - night), 0);

  const consistencyWindow = withinDays(window, CONSISTENCY_WINDOW_DAYS, input.now).map(
    (point) => point.value / SECONDS_PER_HOUR
  );
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

  // Names the number of nights actually MEASURED, and the window they sit in,
  // because those are two different numbers whenever the watch went unworn.
  const covered =
    debtWindow.length === DEBT_WINDOW_DAYS
      ? `the last ${DEBT_WINDOW_DAYS} nights`
      : `${debtWindow.length} recorded nights in the last ${DEBT_WINDOW_DAYS} days`;

  const debtSentence =
    debtHours >= 1
      ? `You are ${debtHours}h under your own usual ${habitualHours}h across ${covered}.`
      : debtHours <= -1
        ? `You are ${round(-debtHours)}h above your own usual ${habitualHours}h across ${covered}.`
        : `Your sleep across ${covered} is close to your usual ${habitualHours}h.`;

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
