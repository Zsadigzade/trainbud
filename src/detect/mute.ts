import type { DateTime } from "luxon";
import type { ContextEntry } from "../history/context.js";
import { FINDING_KINDS, MUTE_ALL, type Finding, type MutedFinding } from "./findings.js";

// SECTION: Muting
//
// The app could always be told things -- a race, an injury, a week of travel --
// and until now the one place it never acted on them was the place the user
// actually looks. You could record that you were away and the Today screen went
// on reporting a raised resting heart rate for three days as though it were
// news. That is the shape of the complaint that produced this file: feedback a
// person can justify and the watch cannot.
//
// Two rules hold the design together.
//
// **Nothing is muted unless the user said so.** An entry silences a finding
// only by naming its kind. Inferring it from the entry's kind -- injury quietens
// heart rate, race quietens load -- is one line of code and a guess about
// causation the data cannot support, and it would hand mute powers to a goal
// somebody typed in March.
//
// **Nothing is deleted.** A muted finding is moved, not dropped. "Nothing
// stands out" and "one thing stands out and you told me why" are different
// sentences, and a surface cannot tell them apart from an array that quietly
// got shorter. This codebase has already paid for that lesson once, in the
// cold-start guard in ./index.ts: an absence rendered as a clean bill of health.

/**
 * Turns whatever a surface received -- an MCP array, a comma-joined form field,
 * a single string -- into mute targets, or throws saying what was allowed.
 *
 * Shared rather than reimplemented per surface. The comment above
 * `describeFindingsCoverage` in ./index.ts records what happens otherwise: the
 * knowledge lived in one `if` in one file, three sibling surfaces never learned
 * it, and each of them went on printing the wrong sentence for months.
 *
 * Rejecting an unknown target matters more here than it looks. A mute that
 * silently did nothing would be discovered by the alarm it failed to stop,
 * which is the worst possible moment to find out.
 */
export function parseMuteTargets(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [value];

  const allowed: string[] = [MUTE_ALL, ...FINDING_KINDS];

  return raw
    .map((each) => (typeof each === "string" ? each.trim() : each))
    .filter((each) => each !== "")
    .map((each) => {
      if (typeof each !== "string" || !allowed.includes(each)) {
        throw new Error(
          `Cannot mute "${String(each)}". Choose from: ${allowed.join(", ")} ("${MUTE_ALL}" mutes all of them).`
        );
      }
      return each;
    });
}

export interface MuteResult {
  /** What still deserves to be said. */
  findings: Finding[];
  /** What was accounted for, and by which entry. */
  muted: MutedFinding[];
}

const KNOWN: ReadonlySet<string> = new Set<string>(FINDING_KINDS);

/** SQL's own predicate, in TypeScript: `from <= date < to`, open-ended when null. */
function activeOn(entry: ContextEntry, date: string): boolean {
  if (entry.effectiveFrom > date) {
    return false;
  }

  return entry.effectiveTo === null || entry.effectiveTo > date;
}

/**
 * An entry counts if it covers the day the finding is about **or** today.
 *
 * The second half is not a convenience. Garmin finalises a sleep score hours
 * after waking and a watch syncs when it feels like it, so the finding a user is
 * staring at when they decide to mute it is routinely dated yesterday. Matching
 * only the finding's own date would accept the mute and leave the alarm
 * ringing -- the failure would look exactly like the bug this replaces.
 */
function covers(entry: ContextEntry, finding: Finding, today: string): boolean {
  return activeOn(entry, finding.date) || activeOn(entry, today);
}

function silences(entry: ContextEntry, finding: Finding): boolean {
  return entry.mutes.some(
    (target) => target === MUTE_ALL || (KNOWN.has(target) && target === finding.kind)
  );
}

/**
 * Pure, and deliberately so: it takes the findings and the entries rather than
 * reaching for the store, which is what lets the whole of this behaviour be
 * tested without a database -- the same bargain every detector in this folder
 * already makes.
 */
export function applyMutes(
  findings: Finding[],
  entries: ContextEntry[],
  now: DateTime
): MuteResult {
  const today = now.toISODate() ?? "";
  const kept: Finding[] = [];
  const muted: MutedFinding[] = [];

  for (const finding of findings) {
    const by = entries.find((entry) => silences(entry, finding) && covers(entry, finding, today));

    if (by === undefined) {
      kept.push(finding);
      continue;
    }

    muted.push({ ...finding, mutedBy: { id: by.id, kind: by.kind, text: by.text } });
  }

  return { findings: kept, muted };
}
