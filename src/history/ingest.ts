import { DateTime } from "luxon";
import {
  fetchBodyCompositionDay,
  fetchHeartRateDay,
  fetchSleepDay,
  fetchStressDay,
  fetchVo2MaxDay,
} from "../garmin/daily.js";
import type { GarminConnectInstance } from "../garmin/garminConnect.js";
import { mapActivity } from "../garmin/daily.js";
import { parseActivityLocalDateTime, parseIsoDate } from "../utils/helpers.js";
import type { ActivitySummary } from "../garmin/types.js";
import { logger } from "../utils/logger.js";
import { GarminApiError } from "../garmin/types.js";
import { writeFixture } from "./capture.js";
import {
  appendRawPayload,
  listIngestedDates,
  markIngested,
  pruneRawPayloads,
  putActivities,
  putMetrics,
} from "./store.js";
import type { IngestOutcome, IngestSource, MetricKind } from "./schema.js";

// SECTION: Ingest
//
// The account is the thing at risk here, and there is no appeal process if
// Garmin decides this looks like a scraper. So: one request in flight, a
// deliberate delay between them, and a checkpoint written after every date so a
// kill resumes where it stopped rather than starting the year again.

/** Days that are never a final answer -- see NEVER_FINAL below. */
const STALE_WINDOW_DAYS = 3;

/** How long a stale-window day is trusted before it is worth asking again. */
const STALE_RECHECK_SECONDS = 60 * 60;

const DEFAULT_DAYS = 365;
const DEFAULT_DELAY_MS = 1000;

/**
 * A watch has a purchase date, and asking Garmin about the months before it is
 * spending requests against the account for nothing. Walking newest-first, a
 * long unbroken run of empty days is the signal that the record has run out.
 *
 * 60 days rather than something tighter because a real person can stop wearing
 * a watch for a while -- an injury, a holiday, a flat charger -- and the older
 * history behind that gap is still worth having. Set to 0 to walk the whole
 * window regardless.
 */
const DEFAULT_STOP_AFTER_EMPTY_DAYS = 60;

/** The sources a full run covers. Exported so no caller keeps its own copy. */
export const DEFAULT_SOURCES: IngestSource[] = [
  "sleep",
  "heart_rate",
  "stress",
  "vo2max",
  "body_composition",
  "activities",
];

/** Connect's page size for the activity list. */
const ACTIVITY_PAGE_SIZE = 100;

/** Backstop against paging forever if the window start is never reached. */
const MAX_ACTIVITY_PAGES = 20;

export interface IngestOptions {
  days?: number;
  delayMs?: number;
  sources?: IngestSource[];
  now?: DateTime;
  signal?: AbortSignal;
  onProgress?: (progress: IngestProgress) => void;
  /** Write each redacted response here, for use as a test fixture. */
  captureDir?: string;
  /** Abandon a source after this many consecutive empty days. 0 disables. */
  stopAfterEmptyDays?: number;
}

export interface IngestProgress {
  date: string;
  source: IngestSource;
  outcome: IngestOutcome;
  done: number;
  total: number;
}

export interface IngestResult {
  fetched: number;
  skipped: number;
  errors: number;
  firstDate: string | null;
  lastDate: string | null;
  /**
   * Set when the run stopped early because the upstream asked it to. The days
   * not reached are counted in `skipped` and are deliberately not checkpointed,
   * so the next run picks them up.
   */
  stoppedBy?: "rate_limit";
}

/** A GarminApiError carrying a 429, however it was wrapped on the way up. */
function isRateLimit(error: unknown): boolean {
  if (error instanceof GarminApiError) {
    return error.statusCode === 429;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes("429") || message.includes("rate limit");
  }
  return false;
}

export interface IngestUnit {
  date: string;
  source: IngestSource;
}

function activityStartDate(activity: ActivitySummary): string {
  return (
    parseActivityLocalDateTime(activity.startTimeLocal).toISODate() ??
    activity.startTimeLocal.slice(0, 10)
  );
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/**
 * A day inside the stale window is never a final answer: a sleep score
 * finalizes hours after waking, VO2 max is recomputed after a qualifying
 * activity, and Connect reports -2 for a day still in progress. Outside that
 * window, any checkpoint is final -- including `empty`, which is what stops a
 * backfill re-fetching a year of days the watch was not worn. `error` is always
 * retried; it says nothing about the data.
 */
function shouldFetch(
  date: string,
  checkpoint: { fetchedAt: number; outcome: IngestOutcome } | undefined,
  today: DateTime,
  nowSeconds: number
): boolean {
  if (!checkpoint) {
    return true;
  }

  if (checkpoint.outcome === "error") {
    return true;
  }

  const age = today.diff(DateTime.fromISO(date, { zone: today.zone }), "days").days;
  const isNeverFinal = age < STALE_WINDOW_DAYS;

  if (!isNeverFinal) {
    return false;
  }

  return nowSeconds - checkpoint.fetchedAt >= STALE_RECHECK_SECONDS;
}

export function pendingWork(options: IngestOptions = {}): IngestUnit[] {
  const days = options.days ?? DEFAULT_DAYS;
  const sources = options.sources ?? DEFAULT_SOURCES;
  const now = options.now ?? DateTime.local();
  const today = now.startOf("day");
  const nowSeconds = now.toUnixInteger();

  const work: IngestUnit[] = [];

  for (const source of sources) {
    // Activities are paged, not addressed by date, so the whole window is one
    // unit of work rather than one per day.
    if (source === "activities") {
      const date = today.toISODate();
      if (date && shouldFetch(date, listIngestedDates(source).get(date), today, nowSeconds)) {
        work.push({ date, source });
      }
      continue;
    }

    const checkpoints = listIngestedDates(source);

    // Newest first: an interrupted backfill should leave the most recent
    // history behind, not the oldest.
    for (let offset = 0; offset < days; offset += 1) {
      const date = today.minus({ days: offset }).toISODate();
      if (!date) {
        continue;
      }

      if (shouldFetch(date, checkpoints.get(date), today, nowSeconds)) {
        work.push({ date, source });
      }
    }
  }

  return work;
}

// SECTION: Source handlers

interface SourceResult {
  raw: unknown;
  metrics: Array<{ kind: MetricKind; value: number }>;
  /**
   * The day the measurement belongs to, when that is not the day asked about.
   * VO2 max is the case: its endpoint ignores the requested date and returns
   * the current reading, so the row has to land on the date the reading was
   * actually taken rather than being copied across the whole range.
   */
  measuredOn?: string;
}

function measured(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function collect(
  entries: Array<[MetricKind, number | null | undefined]>
): Array<{ kind: MetricKind; value: number }> {
  const metrics: Array<{ kind: MetricKind; value: number }> = [];

  for (const [kind, raw] of entries) {
    const value = measured(raw);
    if (value !== null) {
      metrics.push({ kind, value });
    }
  }

  return metrics;
}

async function fetchSource(
  source: IngestSource,
  client: GarminConnectInstance,
  date: Date
): Promise<SourceResult> {
  switch (source) {
    case "sleep": {
      const { raw, mapped } = await fetchSleepDay(client, date);
      return {
        raw,
        metrics: collect([
          ["sleep_seconds", mapped?.totalSleepSeconds],
          ["sleep_score", mapped?.sleepScore],
          ["hrv_overnight", mapped?.avgOvernightHrv],
          ["sleep_stress", mapped?.avgSleepStress],
        ]),
      };
    }
    case "heart_rate": {
      const { raw, mapped } = await fetchHeartRateDay(client, date);
      return {
        raw,
        metrics: collect([
          ["resting_hr", mapped?.restingHeartRate],
          ["max_hr", mapped?.maxHeartRate],
        ]),
      };
    }
    case "stress": {
      const { raw, mapped } = await fetchStressDay(client, date);
      return {
        raw,
        metrics: collect([
          ["stress_avg", mapped?.averageStress],
          ["stress_max", mapped?.maxStress],
        ]),
      };
    }
    case "vo2max": {
      const { raw, mapped } = await fetchVo2MaxDay(client, date);
      return {
        raw,
        metrics: collect([
          ["vo2max", mapped?.vo2Max],
          ["vo2max_cycling", mapped?.vo2MaxCycling],
        ]),
        measuredOn: mapped?.date,
      };
    }
    case "body_composition": {
      const { raw, mapped } = await fetchBodyCompositionDay(client, date);
      // Several weigh-ins can share a date; the last one is the day's figure.
      const entry = mapped?.at(-1);
      return {
        raw,
        metrics: collect([
          ["weight_kg", entry?.weightKg],
          ["body_fat_pct", entry?.bodyFatPercent],
          ["muscle_mass_kg", entry?.muscleMassKg],
        ]),
      };
    }
    case "activities":
      // Handled by ingestActivities, which pages rather than addressing a date.
      return { raw: null, metrics: [] };
  }
}

/**
 * The activity list is paged newest-first, so the first activity older than the
 * window means every remaining page is older still and there is nothing left to
 * ask for.
 */
async function ingestActivities(
  client: GarminConnectInstance,
  windowStart: string,
  stampedAt: number,
  captureDir?: string
): Promise<number> {
  let start = 0;
  let stored = 0;

  for (let page = 0; page < MAX_ACTIVITY_PAGES; page += 1) {
    const activities = await client.getActivities(start, ACTIVITY_PAGE_SIZE);

    if (activities.length === 0) {
      break;
    }

    const mapped = activities.map(mapActivity);
    putActivities(mapped, stampedAt);
    stored += mapped.length;

    if (captureDir) {
      writeFixture(captureDir, "activities", `page-${page}`, activities);
    }

    const reachedWindowStart = mapped.some(
      (activity) => activityStartDate(activity) < windowStart
    );

    if (reachedWindowStart || activities.length < ACTIVITY_PAGE_SIZE) {
      break;
    }

    start += ACTIVITY_PAGE_SIZE;
  }

  return stored;
}

export async function runIngest(
  client: GarminConnectInstance,
  options: IngestOptions = {}
): Promise<IngestResult> {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const work = pendingWork(options);

  // One clock for the whole run. Planning read `options.now` while the
  // checkpoints were stamped from the wall clock, so a caller that supplied a
  // clock got checkpoints the planner could not reason about.
  const stampedAt = (options.now ?? DateTime.local()).toUnixInteger();
  const stopAfterEmptyDays = options.stopAfterEmptyDays ?? DEFAULT_STOP_AFTER_EMPTY_DAYS;

  const emptyRun = new Map<IngestSource, number>();
  const exhausted = new Set<IngestSource>();

  const result: IngestResult = {
    fetched: 0,
    skipped: 0,
    errors: 0,
    firstDate: null,
    lastDate: null,
  };

  let done = 0;

  for (const unit of work) {
    if (options.signal?.aborted) {
      result.skipped += work.length - done;
      break;
    }

    // Deliberately not checkpointed. Skipping is not the same claim as "we
    // asked and there was nothing", so a later run -- with a wider window, or
    // with the limit disabled -- can still reach these days.
    if (exhausted.has(unit.source)) {
      result.skipped += 1;
      done += 1;
      continue;
    }

    let outcome: IngestOutcome;

    try {
      if (unit.source === "activities") {
        const windowStart =
          (options.now ?? DateTime.local())
            .startOf("day")
            .minus({ days: options.days ?? DEFAULT_DAYS })
            .toISODate() ?? "";

        const stored = await ingestActivities(client, windowStart, stampedAt, options.captureDir);

        markIngested(unit.date, unit.source, stored > 0 ? "data" : "empty", stampedAt);
        result.fetched += 1;
        done += 1;
        options.onProgress?.({
          ...unit,
          outcome: stored > 0 ? "data" : "empty",
          done,
          total: work.length,
        });

        if (done < work.length) {
          await delay(delayMs, options.signal);
        }
        continue;
      }

      // parseIsoDate, not new Date(): the bare constructor parses a date-only
      // string as UTC midnight, and garmin-connect formats the Date it is given
      // in local time. West of UTC that combination asks Garmin for the previous
      // day and stores the answer under this one.
      const { raw, metrics, measuredOn } = await fetchSource(
        unit.source,
        client,
        parseIsoDate(unit.date)
      );

      appendRawPayload(unit.date, unit.source, raw, stampedAt);
      putMetrics(measuredOn ?? unit.date, metrics, stampedAt);

      if (options.captureDir) {
        writeFixture(options.captureDir, unit.source, unit.date, raw);
      }

      // A reading that belongs to another day is not a measurement for this
      // one. Recording it as `data` would also defeat the empty-run stop, since
      // every pre-purchase day would answer with today's reading forever.
      const measuredHere = (measuredOn ?? unit.date) === unit.date;
      outcome = metrics.length > 0 && measuredHere ? "data" : "empty";
      result.fetched += 1;
    } catch (error) {
      // One bad day must not end a year-long run -- but a rate limit is not one
      // bad day, it is the upstream saying stop, and carrying on is how a
      // 365-day backfill answered a 429 with seventeen hundred more requests.
      // Each of those deepened the limit and none of them could have succeeded.
      if (isRateLimit(error)) {
        logger.warn(
          { error, ...unit, remaining: work.length - done },
          "Garmin rate limited the ingest; stopping this run"
        );
        markIngested(unit.date, unit.source, "error", stampedAt);
        result.errors += 1;
        result.skipped += work.length - done - 1;
        result.stoppedBy = "rate_limit";
        break;
      }

      logger.warn({ error, ...unit }, "Ingest failed for one day");
      outcome = "error";
      result.errors += 1;
    }

    markIngested(unit.date, unit.source, outcome, stampedAt);

    if (stopAfterEmptyDays > 0) {
      const run = outcome === "empty" ? (emptyRun.get(unit.source) ?? 0) + 1 : 0;
      emptyRun.set(unit.source, run);

      if (run >= stopAfterEmptyDays) {
        exhausted.add(unit.source);
        logger.info(
          { source: unit.source, date: unit.date, emptyDays: run },
          "Reached the start of the record for this source; skipping older days"
        );
      }
    }

    result.firstDate =
      result.firstDate === null || unit.date < result.firstDate ? unit.date : result.firstDate;
    result.lastDate =
      result.lastDate === null || unit.date > result.lastDate ? unit.date : result.lastDate;

    done += 1;
    options.onProgress?.({ ...unit, outcome, done, total: work.length });

    if (done < work.length) {
      await delay(delayMs, options.signal);
    }
  }

  // Every run appends a raw payload per day per source, so the archive grows
  // with the number of runs and not with the amount of history. Bounding it
  // here means the table is trimmed by the thing that fills it, rather than
  // waiting for someone to notice the file.
  if (result.fetched > 0) {
    const pruned = pruneRawPayloads();
    if (pruned.agedOut + pruned.supersededRevisions > 0) {
      logger.debug({ ...pruned }, "Pruned the raw payload archive");
    }
  }

  return result;
}
