import type { DayFetchResult } from "../garmin/partial.js";
import { partialFetchNote } from "../garmin/partial.js";
import type { ActivitySummary } from "../garmin/types.js";
import { formatIsoDate, parseIsoDate } from "../utils/helpers.js";
import { logger } from "../utils/logger.js";
import type { IngestSource, MetricKind } from "./schema.js";
import {
  getActivitiesBetween,
  getMetricsOn,
  newestStoredDates,
  rawPayloadRevisions,
} from "./store.js";

// SECTION: Reading the store when Garmin will not answer
//
// Every per-metric tool read Garmin and nothing else. That made the whole app
// hostage to one request: with the session expired and Cloudflare rate limiting
// sign-in, `get_sleep_data` threw, all six of `buildWatchSummary`'s payload
// calls returned null, and an MCP client was told the request had failed --
// while history.db held 598 measurements and 2139 archived responses covering
// 74 days. The model then reported, accurately, that it had no access to the
// user's data.
//
// The store is not a cache. The cache is TTL-keyed and deletes its own rows;
// this is TrainBud's own copy of the record, kept precisely so that an answer
// exists when the upstream does not. Nothing on the read path had ever opened
// it.
//
// TWO SOURCES, IN THIS ORDER:
//
//   raw_payload   -- the original Connect response, re-run through the SAME
//                    mapper the live path uses. A stored night is therefore not
//                    a thinner night: stages, sleep score and overnight HRV all
//                    survive, and there is no second mapping to drift out of
//                    step with the first. Bounded to 180 days by `prune`.
//   daily_metric  -- the typed rows, never pruned. Thin: the numbers the
//                    detectors need and nothing else. This is what answers for
//                    a day older than the archive.
//
// WHAT THIS DELIBERATELY DOES NOT DO: it does not touch the store when the live
// call succeeded for every day asked about. A complete live answer is the truth
// of record, and quietly merging older rows into it would let a measurement the
// user deleted in Connect reappear here forever.

/** Where the days in an answer came from. Additive; the watch ignores it. */
export interface StoredFallbackInfo {
  /** How many days in the answer came from the local store, not from Garmin. */
  storedDays: number;
  /** Newest date the stored part covers, so a reader can say how old it is. */
  storedThrough: string | null;
  /**
   * True when the days returned are NOT the days asked about.
   *
   * Every tool's window is anchored to today. With the record ending
   * 2026-08-21 and Garmin unreachable on 2026-09-03, "the last 7 nights"
   * selects seven days the store has no row for, so the fallback found nothing
   * and the tool reported an absence -- with seventy nights in the table. The
   * window moves to the newest days on record instead, and this flag is what
   * forces every renderer to say so. A reader that ignored it would present
   * a fortnight-old week as this week, which is a worse failure than the one
   * being fixed.
   */
  storedWindowMoved: boolean;
}

export interface FallbackResult<T> extends DayFetchResult<T>, StoredFallbackInfo {}

export interface FallbackOptions<T> {
  /** The days asked about, in the order the caller wants them back. */
  dates: Date[];
  source: IngestSource;
  /** The live fetch. May reject; that is the case this exists for. */
  live: () => Promise<DayFetchResult<T>>;
  /** The live mapper, re-run over an archived response. */
  fromRaw: (date: Date, payload: unknown) => T | null;
  /** Thin reconstruction for a day older than the raw archive. */
  fromMetrics?: (date: string, metrics: Map<MetricKind, number>) => T | null;
  /**
   * The date a value belongs to. Usually the day asked about; for VO2 max it is
   * the day the measurement was actually taken, which is what collapses one
   * reading returned for thirty requested days into one entry.
   */
  dateOf: (value: T) => string;
}

/** The newest archived response for a day, or null when none was kept. */
export function storedRawPayload(date: string, source: IngestSource): unknown {
  const revisions = rawPayloadRevisions(date, source);
  const newest = revisions.at(-1);
  if (!newest) {
    return null;
  }

  try {
    return JSON.parse(newest.json) as unknown;
  } catch (error) {
    // An archive row that will not parse is a corrupt row, not an answer.
    // Recorded rather than swallowed: this is the class of fault that spent a
    // session being reported as "no public URL is configured".
    logger.warn({ err: error, date, source }, "Archived payload could not be parsed");
    return null;
  }
}

function readStoredDay<T>(date: string, jsDate: Date, options: FallbackOptions<T>): T | null {
  const raw = storedRawPayload(date, options.source);
  if (raw !== null) {
    const mapped = options.fromRaw(jsDate, raw);
    if (mapped !== null) {
      return mapped;
    }
  }

  if (!options.fromMetrics) {
    return null;
  }

  const metrics = getMetricsOn(date);
  return metrics.size > 0 ? options.fromMetrics(date, metrics) : null;
}

function sortNewestFirst<T>(byDate: Map<string, T>): T[] {
  return Array.from(byDate.entries())
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([, value]) => value);
}

export async function fetchDaysOrStore<T>(
  options: FallbackOptions<T>
): Promise<FallbackResult<T>> {
  const requestedDays = options.dates.length;

  let live: DayFetchResult<T>;
  let liveFailed = false;
  try {
    live = await options.live();
  } catch (error) {
    liveFailed = true;
    // The whole call failed rather than a day inside it: no session, a login
    // rate limit, no network. Every day is unreachable, which is exactly the
    // state the store was built for. The error is not rethrown -- it used to
    // reach the MCP client as a tool error, and a tool error is what a model
    // reports as "I cannot access your data".
    logger.info(
      { err: error, source: options.source, days: requestedDays },
      "Live fetch failed; answering from the stored history"
    );
    live = { values: [], unreachableDays: requestedDays, requestedDays };
  }

  if (live.unreachableDays === 0) {
    return { ...live, storedDays: 0, storedThrough: null, storedWindowMoved: false };
  }

  const byDate = new Map<string, T>();
  for (const value of live.values) {
    byDate.set(options.dateOf(value), value);
  }

  const storedDates: string[] = [];
  for (const jsDate of options.dates) {
    const date = formatIsoDate(jsDate);
    if (byDate.has(date)) {
      continue;
    }

    const stored = readStoredDay(date, jsDate, options);
    if (stored === null) {
      continue;
    }

    // Keyed by the value's own date rather than by the date asked about, so a
    // reading that answers for many requested days lands once.
    const key = options.dateOf(stored);
    if (byDate.has(key)) {
      continue;
    }

    byDate.set(key, stored);
    storedDates.push(key);
  }

  let values = sortNewestFirst(byDate);

  // Nothing anywhere for the days asked about, and the live call is down: the
  // window is pointing at days that were never recorded. Move it to the newest
  // days the store does hold rather than reporting an absence.
  let storedWindowMoved = false;
  if (values.length === 0 && liveFailed) {
    for (const date of newestStoredDates(options.source, requestedDays)) {
      const stored = readStoredDay(date, parseIsoDate(date), options);
      if (stored === null) {
        continue;
      }

      const key = options.dateOf(stored);
      if (byDate.has(key)) {
        continue;
      }

      byDate.set(key, stored);
      storedDates.push(key);
      storedWindowMoved = true;
    }

    values = sortNewestFirst(byDate);
  }

  return {
    values,
    // Days the store could not answer either. A day covered from the archive is
    // no longer unreachable, and reporting it as such would put the sentence
    // "could not be fetched" next to the figures it just fetched. A moved
    // window answers none of the days asked about, so all of them stay counted.
    unreachableDays: storedWindowMoved
      ? live.unreachableDays
      : Math.max(0, live.unreachableDays - storedDates.length),
    requestedDays,
    storedDays: storedDates.length,
    storedThrough: storedDates.length > 0 ? (storedDates.slice().sort().at(-1) ?? null) : null,
    storedWindowMoved,
  };
}

/**
 * A value that leans on the store is cached briefly, not for the full TTL.
 *
 * A stored answer is correct and it is also a symptom: the connection is down.
 * Freezing it in for two hours would keep serving yesterday's record for two
 * hours after the tunnel came back.
 */
export function isPartialOrStored(result: {
  unreachableDays: number;
  storedDays: number;
}): boolean {
  return result.unreachableDays > 0 || result.storedDays > 0;
}

/**
 * The one sentence that keeps three different facts apart: nothing was
 * recorded, nothing could be fetched, and this came from our own record rather
 * than from Connect just now.
 *
 * The third is the one that matters. "No sleep data found for the last 7
 * nights" is an assertion about the user's life, and it was being produced by a
 * failed login on top of a store holding ten weeks of nights.
 */
export function storedFetchNote(
  result: DayFetchResult<unknown> & StoredFallbackInfo,
  noun: string
): string {
  if (result.storedDays === 0) {
    return partialFetchNote(result, noun);
  }

  const through = result.storedThrough ?? "an earlier date";
  const liveDays = result.values.length - result.storedDays;

  // The window moved. This has to be unmissable: the dates below are NOT the
  // dates asked about, and a reader that assumed otherwise would describe a
  // fortnight-old week as this week.
  if (result.storedWindowMoved) {
    return [
      `Garmin could not be reached, and TrainBud's record holds nothing at all for the last ${result.requestedDays} ${noun}.`,
      `THESE ARE NOT THE LAST ${result.requestedDays} ${noun.toUpperCase()}. They are the ${result.storedDays} most recent ${noun} on record, ending ${through}.`,
      `Every date is given below; use them. Say which period this describes, and that the record stops at ${through} because the connection is down — not because there is no data about this user.`,
    ].join(" ");
  }

  const stored =
    liveDays > 0
      ? `Note: Garmin could not be reached for ${result.storedDays} of ${result.requestedDays} ${noun}, so those came from TrainBud's own stored history (through ${through}). They are measurements previously fetched, not estimates.`
      : `Garmin could not be reached just now, so these ${result.storedDays} ${noun} come from TrainBud's own stored history, through ${through}. These are real measurements previously fetched from Connect — this is a connection problem, not an absence of data about this user.`;

  if (result.unreachableDays === 0) {
    return stored;
  }

  return `${stored} ${result.unreachableDays} of the ${result.requestedDays} ${noun} asked about are in neither place.`;
}

/**
 * Activities are not addressed by date upstream -- they are a paged list -- so
 * they get their own reader rather than going through `fetchDaysOrStore`.
 */
export function storedActivitiesBetween(
  startDate: string,
  endDate: string
): ActivitySummary[] {
  return getActivitiesBetween(startDate, endDate)
    .map((row) => ({
      activityId: row.activityId,
      name: row.name,
      type: row.type,
      startTimeLocal: row.startTimeLocal,
      distanceMeters: row.distanceMeters,
      durationSeconds: row.durationSeconds,
      averageHeartRate: row.avgHr,
      maxHeartRate: row.maxHr,
      elevationGainMeters: row.elevationGainMeters,
      calories: row.calories,
      averageSpeedMps: row.averageSpeedMps,
    }))
    .sort((left, right) => right.startTimeLocal.localeCompare(left.startTimeLocal));
}
