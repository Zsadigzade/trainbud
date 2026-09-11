import { DateTime } from "luxon";
import {
  activeContext,
  addContextEntry,
  allContext,
  logSubjective,
  subjectiveSeries,
  type ContextEntry,
} from "../history/context.js";
import {
  CONTEXT_KINDS,
  SUBJECTIVE_KINDS,
  type ContextKind,
  type SubjectiveKind,
} from "../history/schema.js";
import { FINDING_KINDS, MUTE_ALL } from "../detect/findings.js";
import { parseMuteTargets } from "../detect/mute.js";
import type { ToolResult } from "../garmin/types.js";
import type {
  ContextListPayload,
  RememberContextPayload,
  SubjectivePayload,
} from "./payloads.js";
import type { ToolDefinition } from "./types.js";

// SECTION: Context tools
//
// The richest input a user will ever give is a sentence they were already
// typing. "Half marathon on October 12, left achilles grumbling since Tuesday"
// becomes two records with no UI at all, which is why these exist before any
// form does.

function parseKind<T extends string>(value: unknown, valid: T[], label: string): T {
  if (typeof value === "string" && (valid as string[]).includes(value)) {
    return value as T;
  }

  throw new Error(`Unknown ${label} "${String(value)}". Choose one of: ${valid.join(", ")}.`);
}

function optionalDate(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string" || !DateTime.fromISO(value).isValid) {
    throw new Error(`${label} must be an ISO date such as 2026-10-12.`);
  }

  return value;
}

function describeEntry(entry: ContextEntry): string {
  const until = entry.effectiveTo ? ` until ${entry.effectiveTo}` : "";
  const muting =
    entry.mutes.length > 0
      ? `, muting ${entry.mutes.includes(MUTE_ALL) ? "every finding" : entry.mutes.join(" and ")}`
      : "";
  return `${entry.kind}: ${entry.text} (from ${entry.effectiveFrom}${until}${muting})`;
}

export async function rememberContext(
  input: Record<string, unknown>
): Promise<ToolResult<RememberContextPayload>> {
  const kind = parseKind<ContextKind>(input.kind, CONTEXT_KINDS, "context kind");
  const text = typeof input.text === "string" ? input.text : "";

  const entry = addContextEntry(kind, text, {
    effectiveFrom: optionalDate(input.effective_from, "effective_from"),
    effectiveTo: optionalDate(input.effective_to, "effective_to"),
    mutes: parseMuteTargets(input.mutes),
  });

  const payload: RememberContextPayload = { entry };

  return {
    type: "text",
    text: `Recorded ${describeEntry(entry)}`,
    data: payload,
  };
}

export async function getUserContext(
  input: Record<string, unknown>
): Promise<ToolResult<ContextListPayload>> {
  const includeClosed = input.include_closed === true;
  const onDate = optionalDate(input.on_date, "on_date") ?? DateTime.local().toISODate() ?? "";

  const entries = includeClosed ? allContext() : activeContext(onDate);
  const payload: ContextListPayload = { onDate, includeClosed, entries };

  if (entries.length === 0) {
    return {
      type: "text",
      text: includeClosed
        ? "Nothing has been recorded yet. Use remember_context to add a goal, race, injury or note."
        : `Nothing on record as of ${onDate}. Use remember_context to add a goal, race, injury or note.`,
      data: payload,
    };
  }

  return {
    type: "text",
    text: [
      includeClosed ? "Everything on record:" : `On record as of ${onDate}:`,
      ...entries.map((entry) => `- ${describeEntry(entry)}`),
    ].join("\n"),
    data: payload,
  };
}

export async function logSubjectiveEntry(
  input: Record<string, unknown>
): Promise<ToolResult<SubjectivePayload>> {
  const kind = parseKind<SubjectiveKind>(input.kind, SUBJECTIVE_KINDS, "rating kind");
  const value = typeof input.value === "number" ? input.value : Number.NaN;
  const date = optionalDate(input.date, "date") ?? DateTime.local().toISODate() ?? "";
  const note = typeof input.note === "string" ? input.note : undefined;

  logSubjective(date, kind, value, note);

  const payload: SubjectivePayload = {
    date,
    kind,
    value,
    note: note?.trim() || null,
    recent: subjectiveSeries(
      kind,
      DateTime.fromISO(date).minus({ days: 30 }).toISODate() ?? date,
      date
    ),
  };

  return {
    type: "text",
    text: `Recorded ${kind} ${value}/10 for ${date}${note ? ` — ${note.trim()}` : ""}`,
    data: payload,
  };
}

export const contextToolDefinitions: ToolDefinition[] = [
  {
    name: "remember_context",
    description:
      "Records something about the user that Garmin does not know: a goal, a race and its date, an injury, or a free-form note. Use this whenever the user mentions one in passing. It can also silence a finding the user has already accounted for — see `mutes`.",
    inputSchema: {
      kind: {
        type: "string",
        description: `One of: ${CONTEXT_KINDS.join(", ")}.`,
      },
      text: {
        type: "string",
        description: "What to remember, in the user's own words where possible.",
      },
      effective_from: {
        type: "string",
        description: "ISO date this became true. Defaults to today.",
      },
      effective_to: {
        type: "string",
        description:
          "ISO date this stops being true, for a race date or a healed injury. When `mutes` is set and this is left out, the mute expires on its own after two weeks.",
      },
      mutes: {
        type: "array",
        description: `Finding kinds this entry should silence while it holds, for when the user can explain something the watch cannot — "I was travelling, stop telling me my resting heart rate is up". One or more of: ${FINDING_KINDS.join(", ")}, or "${MUTE_ALL}" for all of them. Set this ONLY when the user asks to stop being told something; recording a goal, race or injury must not silence anything by itself.`,
      },
    },
    handler: rememberContext,
  },
  {
    name: "get_user_context",
    description:
      "Returns the goals, races, injuries and notes on record for the user. Read this before giving training advice.",
    inputSchema: {
      on_date: {
        type: "string",
        description: "ISO date to evaluate against. Defaults to today.",
      },
      include_closed: {
        type: "boolean",
        description: "Include entries that have since ended. Defaults to false.",
      },
    },
    handler: getUserContext,
  },
  {
    name: "log_subjective",
    description:
      "Records how a day or session actually felt, rated 1-10: perceived effort (rpe), soreness, or mood. Garmin has no equivalent.",
    inputSchema: {
      kind: {
        type: "string",
        description: `One of: ${SUBJECTIVE_KINDS.join(", ")}.`,
      },
      value: {
        type: "number",
        description: "A rating from 1 to 10.",
      },
      date: {
        type: "string",
        description: "ISO date the rating is for. Defaults to today.",
      },
      note: {
        type: "string",
        description: "Optional free-text detail.",
      },
    },
    handler: logSubjectiveEntry,
  },
];
