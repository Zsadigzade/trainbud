import type { WatchRace, WatchSummary } from "./watchApi.js";

// SECTION: Spoken day summary
//
// "Read me my day" out of the data that is already on screen. No model call, so
// it costs nothing, cannot be refused by a spending cap, and says the same
// thing twice in a row -- which matters more than it sounds: a spoken summary
// that reworded itself every time would make it impossible to notice that a
// number had actually changed.
//
// Written for an ear rather than an eye. Three rules follow from that:
//
//   NO SYMBOLS. Speech synthesis reads "1.6x" as "one point six ex" and
//   "-4 bpm" as "minus four bee pee em". Units and comparisons are spelled out.
//
//   NO EMPTY SLOTS. A screen can show a dash for a missing night and the eye
//   skips it. An ear cannot skip; "sleep, unknown" in the middle of a sentence
//   sounds like a fault. A metric with no measurement is left out entirely, and
//   if everything is missing the summary says so in one sentence.
//
//   SHORT SENTENCES. The listener is moving and cannot rewind.

function round(value: number, places = 0): string {
  const factor = 10 ** places;
  return String(Math.round(value * factor) / factor);
}

/** "7.5 hours" / "1 hour" — never "1 hours". */
function hours(value: number): string {
  const text = round(value, 1);
  return `${text} ${text === "1" ? "hour" : "hours"}`;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Strip the shorthand a screen tolerates and an ear does not.
 *
 * Findings are written for the watch's 200-pixel strip, so they are full of
 * "1.6x", "bpm" and "+4". Spoken verbatim they are close to unintelligible.
 */
export function speakable(text: string): string {
  return text
    .replace(/(\d+(?:\.\d+)?)\s*x\b/gi, "$1 times")
    .replace(/\bbpm\b/gi, "beats per minute")
    .replace(/\bhrv\b/gi, "H R V")
    .replace(/\bvo2\s*max\b/gi, "VO2 max")
    .replace(/\brhr\b/gi, "resting heart rate")
    .replace(/\bTRIMP\b/g, "training load")
    .replace(/(\d)\s*%/g, "$1 percent")
    .replace(/(?<=\s)\+(?=\d)/g, "up ")
    .replace(/(?<=\s)-(?=\d)/g, "down ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export interface SpokenDay {
  /** One paragraph, ready for speechSynthesis. */
  text: string;
  /** The same content in lines, for the page to show while it is spoken. */
  lines: string[];
}

/**
 * Compose the spoken summary from the same payload the watch draws.
 *
 * Reusing `WatchSummary` rather than re-querying is deliberate: the watch, the
 * dashboard and the spoken summary then cannot disagree about what today was.
 * A second query would eventually drift, and the bug would be somebody hearing
 * a number their watch never showed.
 */
export function composeSpokenDay(summary: WatchSummary, name?: string): SpokenDay {
  const lines: string[] = [];
  const who = name?.trim() ? `, ${name.trim()}` : "";

  if (!summary.coverage.ready) {
    const days = summary.coverage.days;
    return {
      text: speakable(
        `Not enough history yet${who}. TrainBud has ${plural(days, "day")} of data and needs a couple of weeks ` +
          `before it can tell you what has changed about you. Everything is still being recorded.`
      ),
      lines: [`Not enough history yet — ${plural(days, "day")} recorded.`],
    };
  }

  // --- what stands out, first, because it is why anyone asked ---------------

  const notable = summary.findings.filter((finding) => finding.severity !== "info").slice(0, 3);

  if (notable.length > 0) {
    lines.push(`What stands out: ${notable.map((f) => f.headline).join(". ")}.`);
  } else {
    lines.push("Nothing stands out today. Everything is inside your usual range.");
  }

  // --- the numbers, only the ones that exist -------------------------------

  // Each measure is a whole sentence, capitalised, because they are joined with
  // full stops and any metric can be the one that is missing. Building them as
  // clauses produced "Today: recovery 86. you slept 5.6 hours." -- correct data
  // read as a stammer.
  const measures: string[] = [];
  if (summary.recovery) {
    measures.push(`Recovery ${summary.recovery.score}, which is ${summary.recovery.label}`);
  }
  if (summary.sleep) {
    const scored = summary.sleep.score !== null ? `, scoring ${summary.sleep.score}` : "";
    measures.push(`You slept ${hours(summary.sleep.hours)}${scored}`);
  }
  if (summary.stress) {
    measures.push(`Average stress ${summary.stress.avg}, ${summary.stress.label}`);
  }

  if (measures.length > 0) {
    lines.push(`Today${who}. ${measures.join(". ")}.`);
  } else {
    // Every metric missing is itself the news, and it has one likely cause.
    lines.push("No measurements for today yet. Sync your watch with Connect.");
  }

  // --- the week, which is the part a single day cannot tell you -------------

  const week = summary.week;
  if (week) {
    const weekParts: string[] = [];
    weekParts.push(
      `${plural(week.sessions, "session")} this week against ${week.previous_sessions} last week`
    );

    if (week.load_delta_pct !== null && Math.abs(week.load_delta_pct) >= 5) {
      const direction = week.load_delta_pct > 0 ? "up" : "down";
      weekParts.push(`training load ${direction} ${Math.abs(week.load_delta_pct)} percent`);
    }

    if (week.sleep_debt_h !== null && week.sleep_debt_h >= 1) {
      const against =
        week.sleep_habitual_h !== null ? ` against your usual ${hours(week.sleep_habitual_h)}` : "";
      weekParts.push(`you are ${hours(week.sleep_debt_h)} short on sleep${against}`);
    }

    lines.push(`This week: ${weekParts.join(", ")}.`);

    if (week.forecast_verdict === "spike_ahead") {
      lines.push("If next week repeats this one, your load spikes. Worth easing off.");
    } else if (week.forecast_verdict === "detraining_ahead") {
      lines.push("If next week repeats this one, you start losing fitness.");
    }
  }

  // --- the race, when there is one -----------------------------------------

  if (summary.race) {
    lines.push(raceLine(summary.race));
  }

  return { text: speakable(lines.join(" ")), lines };
}

/**
 * The race line, spoken.
 *
 * `race.text` is already a countdown written for the watch strip, so it is not
 * repeated here — saying the phase and then reading the same countdown back
 * would be the summary talking twice about one thing.
 */
export function raceLine(race: WatchRace): string {
  const days = race.days_away;

  if (days <= 0) return "Race day is today.";
  if (days === 1) return "Your race is tomorrow.";

  const phase =
    race.phase === "race_week"
      ? " It is race week."
      : race.phase === "taper"
        ? " You are in the taper."
        : "";

  return `${plural(days, "day")} until your race.${phase}`;
}
