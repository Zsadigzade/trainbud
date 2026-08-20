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
}

export interface SubjectivePoint {
  date: string;
  value: number;
  note: string | null;
}

const SUBJECTIVE_MIN = 1;
const SUBJECTIVE_MAX = 10;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function today(): string {
  return DateTime.local().toISODate() ?? "";
}

export interface AddContextOptions {
  effectiveFrom?: string;
  effectiveTo?: string;
}

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

  const entry = {
    kind,
    text: trimmed,
    effectiveFrom: options.effectiveFrom ?? today(),
    effectiveTo: options.effectiveTo ?? null,
    createdAt: nowSeconds(),
  };

  const result = getHistoryDb()
    .prepare(
      `INSERT INTO context_entry (kind, text, effective_from, effective_to, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(entry.kind, entry.text, entry.effectiveFrom, entry.effectiveTo, entry.createdAt);

  return { id: Number(result.lastInsertRowid), ...entry };
}

/** Everything true on the given date, newest first. */
export function activeContext(onDate: string): ContextEntry[] {
  return getHistoryDb()
    .prepare(
      `SELECT
         id,
         kind,
         text,
         effective_from AS effectiveFrom,
         effective_to   AS effectiveTo,
         created_at     AS createdAt
       FROM context_entry
       WHERE effective_from <= ?
         AND (effective_to IS NULL OR effective_to > ?)
       ORDER BY effective_from DESC, id DESC`
    )
    .all(onDate, onDate) as ContextEntry[];
}

/** Every entry ever recorded, newest first — for a dashboard or a tool listing. */
export function allContext(): ContextEntry[] {
  return getHistoryDb()
    .prepare(
      `SELECT
         id,
         kind,
         text,
         effective_from AS effectiveFrom,
         effective_to   AS effectiveTo,
         created_at     AS createdAt
       FROM context_entry
       ORDER BY effective_from DESC, id DESC`
    )
    .all() as ContextEntry[];
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
