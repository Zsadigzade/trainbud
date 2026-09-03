import { DateTime } from "luxon";
import type { ContextEntry } from "../history/context.js";

// SECTION: Race countdown
//
// The context store has held races since the memory layer landed and nothing
// has ever read them for their date. A race is the one piece of context that
// changes what every other number means: the same load ratio is a warning
// eleven weeks out and expected three days out, and a short night matters
// differently the week of an event than it does in January.
//
// A pure function over entries rather than a store query, so it is testable
// without a database -- the same reason every detector takes a DetectorInput.

/** How the current week relates to the event. */
export type RacePhase = "race_week" | "taper" | "build" | "far_out";

export interface RaceCountdown {
  text: string;
  date: string;
  daysAway: number;
  phase: RacePhase;
  /** Short enough for a watch card. */
  label: string;
}

const TAPER_DAYS = 21;
const FAR_OUT_DAYS = 84;

function phaseFor(daysAway: number): RacePhase {
  if (daysAway <= 7) {
    return "race_week";
  }
  if (daysAway <= TAPER_DAYS) {
    return "taper";
  }
  return daysAway <= FAR_OUT_DAYS ? "build" : "far_out";
}

/**
 * The next race on or after `today`, nearest first.
 *
 * A race entry's effective_from is the day of the event. Entries whose date has
 * passed are not returned -- but they are deliberately not deleted either, so
 * "how did the last build go" still has something to read.
 *
 * A race with no parseable date is skipped rather than guessed at. Showing a
 * countdown to the wrong day is worse than showing none: the whole point of the
 * number is that the user stops doing their own arithmetic.
 */
export function nextRace(entries: ContextEntry[], today: string): RaceCountdown | null {
  const from = DateTime.fromISO(today).startOf("day");
  if (!from.isValid) {
    return null;
  }

  let best: RaceCountdown | null = null;

  for (const entry of entries) {
    if (entry.kind !== "race") {
      continue;
    }

    const date = DateTime.fromISO(entry.effectiveFrom).startOf("day");
    if (!date.isValid) {
      continue;
    }

    const daysAway = Math.round(date.diff(from, "days").days);
    if (daysAway < 0) {
      continue;
    }

    if (best === null || daysAway < best.daysAway) {
      best = {
        text: entry.text,
        date: entry.effectiveFrom,
        daysAway,
        phase: phaseFor(daysAway),
        label:
          daysAway === 0
            ? "Today"
            : daysAway === 1
              ? "Tomorrow"
              : `${daysAway} days`,
      };
    }
  }

  return best;
}

/**
 * One sentence for the model's context. Says what the phase means for training
 * and nothing about how the user should feel or whether they are ready --
 * neither is knowable from a date.
 */
export function describeRace(race: RaceCountdown | null): string | null {
  if (!race) {
    return null;
  }

  const lead = `${race.text} is in ${race.daysAway} day${race.daysAway === 1 ? "" : "s"} (${race.date}).`;

  switch (race.phase) {
    case "race_week":
      return `${lead} This is race week: load should be coming down, and a light week is the plan rather than a lapse.`;
    case "taper":
      return `${lead} This is the taper window, so a falling load ratio is intended.`;
    case "build":
      return `${lead} Still in the build, so load should be climbing gradually rather than holding flat.`;
    default:
      return `${lead} Far enough out that this week's training is general rather than race-specific.`;
  }
}
