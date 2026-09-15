import { DateTime } from "luxon";
import { FINDING_KINDS, type FindingKind } from "./detect/findings.js";
import { activeContext, addContextEntry } from "./history/context.js";

// SECTION: Mute from the wrist
//
// "Being able to ignore feedback that I can justify but the watch can't" --
// the reply that led to mutes (2026-09-12). They could be set from the
// dashboard, an MCP client or the CLI, and not from the one surface actually
// showing the finding. The Today card offers it from 2.1.0.
//
// Three days, not the fourteen a dashboard mute defaults to. A wrist mute is
// "I know why, today", made with no room to type a reason or an end date; three
// days covers the run a finding describes and lapses before a genuinely new
// problem could hide behind it.

export const WATCH_MUTE_DAYS = 3;

/** Written into the entry, so the dashboard and the model can say where it came from. */
const WATCH_MUTE_TEXT = "Muted from the watch";

export interface WatchMuteResult {
  id: number;
  kind: FindingKind;
  /** First day the finding is heard again (the entry's exclusive end). */
  until: string;
}

function isFindingKind(value: string): value is FindingKind {
  return (FINDING_KINDS as string[]).includes(value);
}

export function muteFromWatch(kind: string, now: DateTime = DateTime.local()): WatchMuteResult {
  // One kind, never "*". Silencing everything is a decision worth a keyboard
  // and a reason; a single press on a watch is not that.
  if (!isFindingKind(kind)) {
    throw new Error(`Unknown finding "${kind}". Choose from: ${FINDING_KINDS.join(", ")}.`);
  }

  const today = now.toISODate() ?? "";
  const until = now.startOf("day").plus({ days: WATCH_MUTE_DAYS }).toISODate() ?? "";

  // Pressing it twice is not two decisions. A second entry would show up twice
  // in the dashboard's muted list with the same words.
  const existing = activeContext(today).find(
    (entry) => entry.text === WATCH_MUTE_TEXT && entry.mutes.length === 1 && entry.mutes[0] === kind
  );
  if (existing) {
    return { id: existing.id, kind, until: existing.effectiveTo ?? until };
  }

  const entry = addContextEntry("note", WATCH_MUTE_TEXT, {
    effectiveFrom: today,
    effectiveTo: until,
    mutes: [kind],
  });

  return { id: entry.id, kind, until };
}
