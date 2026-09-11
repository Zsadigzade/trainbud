import { DateTime } from "luxon";
import { getHistoryDb } from "./store.js";
import type { ContextKind, SubjectiveKind } from "./schema.js";

// SECTION: User context
//
// Everything Garmin has no idea about. Connect holds the measurements and no
// notion of who is being measured, what they are training for, what hurts, or
// how a session actually felt -- and that gap is the entire reason this app can
// say anything Connect cannot.

export interface ContextEntry {
  id: number;
  kind: ContextKind;
  text: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: number;
  /**
   * Finding kinds this entry silences while it is in force, or `["*"]` for all
   * of them. Empty for every entry that only records something.
   *
   * Stored as loose strings on purpose. This layer holds what the user said; it
   * is not the place that knows which finding kinds exist, and a row written by
   * an older or newer build must never be able to break a read. The detect
   * layer matches these against its own list, and anything it does not
   * recognise simply mutes nothing.
   */
  mutes: string[];
}

export interface SubjectivePoint {
  date: string;
  value: number;
  note: string | null;
}

const SUBJECTIVE_MIN = 1;
const SUBJECTIVE_MAX = 10;

/**
 * How long a mute lasts when the user does not say.
 *
 * An open-ended mute is how a person turns the app off without deciding to:
 * "ignore my resting heart rate, I am travelling" is true for a week, and then
 * it is a permanent blind spot nobody remembers creating. A mute that expires
 * makes forgetting the safe outcome rather than the dangerous one -- the alarm
 * comes back on its own, and re-muting it is one sentence.
 *
 * Recording something is different: a goal or a healed injury is history and
 * has every right to be open-ended. Only muting entries get the default.
 */
const DEFAULT_MUTE_DAYS = 14;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function today(): string {
  return DateTime.local().toISODate() ?? "";
}

export interface AddContextOptions {
  effectiveFrom?: string;
  effectiveTo?: string;
  mutes?: string[];
}

interface ContextRow {
  id: number;
  kind: ContextKind;
  text: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: number;
  mutes: string | null;
}

/**
 * Never throws. A row whose `mutes` is malformed mutes nothing, which fails in
 * the direction that keeps telling the user things -- the opposite failure
 * silences an alarm because of a JSON error and reports a clean day.
 */
function parseMutes(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((value): value is string => typeof value === "string" && value.length > 0);
  } catch {
    return [];
  }
}

function toEntry(row: ContextRow): ContextEntry {
  const { mutes, ...rest } = row;
  return { ...rest, mutes: parseMutes(mutes) };
}

const SELECT_COLUMNS = `
  id,
  kind,
  text,
  effective_from AS effectiveFrom,
  effective_to   AS effectiveTo,
  created_at     AS createdAt,
  mutes`;

/**
 * Entries carry a date range rather than an is-current flag. An injury heals
 * and a race happens, and an entry that can only ever be "current" has to be
 * deleted to stop being true -- which loses the fact that it *was* true. "How
 * did the last build go, when the achilles was bad" is exactly the question
 * this layer exists to answer.
 */
export function addContextEntry(
  kind: ContextKind,
  text: string,
  options: AddContextOptions = {}
): ContextEntry {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    throw new Error("Context entry text cannot be empty.");
  }

  const mutes = (options.mutes ?? []).map((value) => value.trim()).filter((value) => value !== "");
  const effectiveFrom = options.effectiveFrom ?? today();

  const entry = {
    kind,
    text: trimmed,
    effectiveFrom,
    effectiveTo: options.effectiveTo ?? defaultEndFor(mutes, effectiveFrom),
    createdAt: nowSeconds(),
    mutes,
  };

  const result = getHistoryDb()
    .prepare(
      `INSERT INTO context_entry (kind, text, effective_from, effective_to, created_at, mutes)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      entry.kind,
      entry.text,
      entry.effectiveFrom,
      entry.effectiveTo,
      entry.createdAt,
      mutes.length > 0 ? JSON.stringify(mutes) : null
    );

  return { id: Number(result.lastInsertRowid), ...entry };
}

/** Open-ended for a plain record; DEFAULT_MUTE_DAYS for anything that silences. */
function defaultEndFor(mutes: string[], effectiveFrom: string): string | null {
  if (mutes.length === 0) {
    return null;
  }

  return DateTime.fromISO(effectiveFrom).plus({ days: DEFAULT_MUTE_DAYS }).toISODate();
}

/** Everything true on the given date, newest first. */
export function activeContext(onDate: string): ContextEntry[] {
  const rows = getHistoryDb()
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM context_entry
       WHERE effective_from <= ?
         AND (effective_to IS NULL OR effective_to > ?)
       ORDER BY effective_from DESC, id DESC`
    )
    .all(onDate, onDate) as ContextRow[];

  return rows.map(toEntry);
}

/**
 * Entries dated after `onDate`, soonest first.
 *
 * activeContext deliberately excludes these: an entry is "true on a date" only
 * from its effective_from onwards, and a race in six weeks is not a fact about
 * today. But a future race is the single most useful piece of context this
 * store holds — it changes what every other number means, because the same load
 * ratio is a warning eleven weeks out and the plan three days out — and until
 * now nothing could read one, because the only reader excluded it by design.
 */
export function upcomingContext(onDate: string): ContextEntry[] {
  const rows = getHistoryDb()
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM context_entry
       WHERE effective_from > ?
       ORDER BY effective_from ASC, id ASC`
    )
    .all(onDate) as ContextRow[];

  return rows.map(toEntry);
}

/** Every entry ever recorded, newest first — for a dashboard or a tool listing. */
export function allContext(): ContextEntry[] {
  const rows = getHistoryDb()
    .prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM context_entry
       ORDER BY effective_from DESC, id DESC`
    )
    .all() as ContextRow[];

  return rows.map(toEntry);
}

/** Ends an entry without deleting it. Returns false if there was no such entry. */
export function closeContextEntry(id: number, onDate: string = today()): boolean {
  const result = getHistoryDb()
    .prepare("UPDATE context_entry SET effective_to = ? WHERE id = ?")
    .run(onDate, id);

  return result.changes > 0;
}

/**
 * The 1-10 scale is what makes these comparable across days, so a 0 or a 12 is
 * a typo rather than a reading. Storing it silently would poison every average
 * built on top.
 */
export function logSubjective(
  date: string,
  kind: SubjectiveKind,
  value: number,
  note?: string
): void {
  if (!Number.isFinite(value) || value < SUBJECTIVE_MIN || value > SUBJECTIVE_MAX) {
    throw new Error(
      `A ${kind} rating must be a number between ${SUBJECTIVE_MIN} and ${SUBJECTIVE_MAX}.`
    );
  }

  getHistoryDb()
    .prepare(
      `INSERT INTO subjective (date, kind, value, note, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(date, kind) DO UPDATE SET
         value = excluded.value,
         note = excluded.note,
         created_at = excluded.created_at`
    )
    .run(date, kind, value, note?.trim() || null, nowSeconds());
}

export function subjectiveSeries(
  kind: SubjectiveKind,
  startDate: string,
  endDate: string
): SubjectivePoint[] {
  return getHistoryDb()
    .prepare(
      `SELECT date, value, note FROM subjective
       WHERE kind = ? AND date >= ? AND date <= ?
       ORDER BY date ASC`
    )
    .all(kind, startDate, endDate) as SubjectivePoint[];
}
