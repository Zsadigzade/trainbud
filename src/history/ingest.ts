import { DateTime } from "luxon";
import {
  fetchBodyCompositionDay,
  fetchHeartRateDay,
  fetchSleepDay,
  fetchStressDay,
  fetchVo2MaxDay,
} from "../garmin/daily.js";
import type { GarminConnectInstance } from "../garmin/garminConnect.js";
import { logger } from "../utils/logger.js";
import {
  appendRawPayload,
  listIngestedDates,
  markIngested,
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

const DEFAULT_SOURCES: IngestSource[] = [
  "sleep",
  "heart_rate",
  "stress",
  "vo2max",
  "body_composition",
];

export interface IngestOptions {
  days?: number;
  delayMs?: number;
  sources?: IngestSource[];
  now?: DateTime;
  signal?: AbortSignal;
  onProgress?: (progress: IngestProgress) => void;
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
}

export interface IngestUnit {
  date: string;
  source: IngestSource;
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
      // Activities are paged, not per-date, and are ingested separately.
      return { raw: null, metrics: [] };
  }
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

    let outcome: IngestOutcome;

    try {
      const { raw, metrics } = await fetchSource(unit.source, client, new Date(unit.date));

      appendRawPayload(unit.date, unit.source, raw, stampedAt);
      putMetrics(unit.date, metrics, stampedAt);

      outcome = metrics.length > 0 ? "data" : "empty";
      result.fetched += 1;
    } catch (error) {
      // One bad day must not end a year-long run.
      logger.warn({ error, ...unit }, "Ingest failed for one day");
      outcome = "error";
      result.errors += 1;
    }

    markIngested(unit.date, unit.source, outcome, stampedAt);

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

  return result;
}
