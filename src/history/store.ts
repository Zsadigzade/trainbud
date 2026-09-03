import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { appConfig } from "../config.js";
import type { ActivitySummary } from "../garmin/types.js";
import { parseActivityLocalDateTime } from "../utils/helpers.js";
import {
  HISTORY_SCHEMA,
  type IngestOutcome,
  type IngestSource,
  type MetricKind,
} from "./schema.js";

// SECTION: History store
//
// Kept in its own database rather than in app.db. app.db holds settings, pair
// tokens and prompt jobs -- small, operational, and safe to delete. This one
// grows to a year of measurements plus every raw response behind them, and
// wanting to drop or back up one without the other is the normal case.

export interface MetricPoint {
  date: string;
  value: number;
}

export interface StoredActivity {
  activityId: number;
  date: string;
  startTimeLocal: string;
  name: string;
  type: string;
  distanceMeters: number | null;
  durationSeconds: number | null;
  avgHr: number | null;
  maxHr: number | null;
  elevationGainMeters: number | null;
  calories: number | null;
  averageSpeedMps: number | null;
}

export interface HistoryStats {
  metricRows: number;
  rawRows: number;
  activityRows: number;
  oldestDate: string | null;
  newestDate: string | null;
  /** Days asked about that Garmin had nothing for -- usually pre-purchase. */
  emptyDays: number;
}

let db: Database.Database | null = null;

function defaultHistoryPath(): string {
  return path.resolve(path.dirname(appConfig.cachePath), "history.db");
}

export function openHistoryDb(databasePath = defaultHistoryPath()): Database.Database {
  if (db) {
    return db;
  }

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  db = new Database(databasePath);
  db.exec(HISTORY_SCHEMA);
  return db;
}

function getDb(): Database.Database {
  return db ?? openHistoryDb();
}

/** The same handle, for the sibling modules that share this database. */
export function getHistoryDb(): Database.Database {
  return getDb();
}

export function closeHistoryDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// SECTION: Metrics

export function putMetrics(
  date: string,
  metrics: Array<{ kind: MetricKind; value: number }>,
  fetchedAt = nowSeconds()
): void {
  if (metrics.length === 0) {
    return;
  }

  const statement = getDb().prepare(
    `INSERT INTO daily_metric (date, kind, value, fetched_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(date, kind) DO UPDATE SET
       value = excluded.value,
       fetched_at = excluded.fetched_at`
  );

  const writeAll = getDb().transaction(
    (rows: Array<{ kind: MetricKind; value: number }>) => {
      for (const row of rows) {
        // A non-finite value is not a measurement. NaN reaching a store is how
        // the recovery score spent months rendering as "null/100" -- guard at
        // the boundary rather than discovering it three layers up.
        if (Number.isFinite(row.value)) {
          statement.run(date, row.kind, row.value, fetchedAt);
        }
      }
    }
  );

  writeAll(metrics);
}

export function getMetricSeries(
  kind: MetricKind,
  startDate: string,
  endDate: string
): MetricPoint[] {
  return getDb()
    .prepare(
      `SELECT date, value FROM daily_metric
       WHERE kind = ? AND date >= ? AND date <= ?
       ORDER BY date ASC`
    )
    .all(kind, startDate, endDate) as MetricPoint[];
}

// SECTION: Raw archive

export function appendRawPayload(
  date: string,
  source: IngestSource,
  payload: unknown,
  fetchedAt = nowSeconds()
): void {
  getDb()
    .prepare(
      "INSERT INTO raw_payload (date, source, fetched_at, json) VALUES (?, ?, ?, ?)"
    )
    .run(date, source, fetchedAt, JSON.stringify(payload ?? null));
}

/**
 * How many revisions of one (date, source) are worth keeping.
 *
 * The archive exists because Garmin restates data -- a sleep score finalises
 * hours after waking, VO2 max is recomputed after a qualifying activity -- and
 * an archive that overwrote would hide the revision worth seeing. But the table
 * was append-only with no ceiling at all, and every backfill re-writes every day
 * it touches: a nightly catch-up over a year of history adds a row per day per
 * source per run, forever. Three revisions keep the restatement visible; the
 * fourth only records that a scheduler ran.
 */
export const RAW_REVISIONS_KEPT = 3;

/**
 * Age past which a raw payload is dropped entirely. The derived rows --
 * daily_metric, activity, ingest_day -- are never touched by pruning, so
 * history and every baseline computed from it survive intact. What is lost is
 * only the ability to re-derive a day older than this from the original JSON.
 */
export const RAW_RETENTION_DAYS = 180;

export interface RawPruneResult {
  /** Rows dropped for being older than the retention window. */
  agedOut: number;
  /** Rows dropped for being the fourth or later revision of one day. */
  supersededRevisions: number;
}

/**
 * Bound the raw archive. Safe to call repeatedly; it is a no-op once the table
 * is already within both limits.
 */
export function pruneRawPayloads(
  now = nowSeconds(),
  retentionDays = RAW_RETENTION_DAYS,
  revisionsKept = RAW_REVISIONS_KEPT
): RawPruneResult {
  const database = getDb();
  const cutoff = now - retentionDays * 86_400;

  return database.transaction((): RawPruneResult => {
    const agedOut = database
      .prepare("DELETE FROM raw_payload WHERE fetched_at < ?")
      .run(cutoff).changes;

    // Rank within each (date, source) newest-first and drop everything past the
    // cut. Ordering by id as well as fetched_at keeps this deterministic when
    // two writes land in the same second, which a batched backfill does often.
    const supersededRevisions = database
      .prepare(
        `DELETE FROM raw_payload
         WHERE id IN (
           SELECT id FROM (
             SELECT id, ROW_NUMBER() OVER (
               PARTITION BY date, source ORDER BY fetched_at DESC, id DESC
             ) AS rank
             FROM raw_payload
           )
           WHERE rank > ?
         )`
      )
      .run(revisionsKept).changes;

    return { agedOut, supersededRevisions };
  })();
}

export function rawPayloadRevisions(
  date: string,
  source: IngestSource
): Array<{ fetchedAt: number; json: string }> {
  return getDb()
    .prepare(
      `SELECT fetched_at AS fetchedAt, json FROM raw_payload
       WHERE date = ? AND source = ?
       ORDER BY fetched_at ASC, id ASC`
    )
    .all(date, source) as Array<{ fetchedAt: number; json: string }>;
}

// SECTION: Ingest checkpoints

export function markIngested(
  date: string,
  source: IngestSource,
  outcome: IngestOutcome,
  fetchedAt = nowSeconds()
): void {
  getDb()
    .prepare(
      `INSERT INTO ingest_day (date, source, fetched_at, outcome)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(date, source) DO UPDATE SET
         fetched_at = excluded.fetched_at,
         outcome = excluded.outcome`
    )
    .run(date, source, fetchedAt, outcome);
}

export function getIngestCheckpoint(
  date: string,
  source: IngestSource
): { fetchedAt: number; outcome: IngestOutcome } | null {
  const row = getDb()
    .prepare(
      "SELECT fetched_at AS fetchedAt, outcome FROM ingest_day WHERE date = ? AND source = ?"
    )
    .get(date, source) as { fetchedAt: number; outcome: IngestOutcome } | undefined;

  return row ?? null;
}

/** Every checkpointed date for a source, for the ingest planner. */
export function listIngestedDates(source: IngestSource): Map<string, { fetchedAt: number; outcome: IngestOutcome }> {
  const rows = getDb()
    .prepare(
      "SELECT date, fetched_at AS fetchedAt, outcome FROM ingest_day WHERE source = ?"
    )
    .all(source) as Array<{ date: string; fetchedAt: number; outcome: IngestOutcome }>;

  return new Map(rows.map((row) => [row.date, { fetchedAt: row.fetchedAt, outcome: row.outcome }]));
}

// SECTION: Activities

function activityDate(activity: ActivitySummary): string {
  return (
    parseActivityLocalDateTime(activity.startTimeLocal).toISODate() ??
    activity.startTimeLocal.slice(0, 10)
  );
}

export function putActivities(
  activities: ActivitySummary[],
  fetchedAt = nowSeconds()
): void {
  if (activities.length === 0) {
    return;
  }

  const statement = getDb().prepare(
    `INSERT INTO activity (
       activity_id, date, start_time_local, name, type,
       distance_m, duration_s, avg_hr, max_hr,
       elevation_gain_m, calories, avg_speed_mps, fetched_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(activity_id) DO UPDATE SET
       date = excluded.date,
       start_time_local = excluded.start_time_local,
       name = excluded.name,
       type = excluded.type,
       distance_m = excluded.distance_m,
       duration_s = excluded.duration_s,
       avg_hr = excluded.avg_hr,
       max_hr = excluded.max_hr,
       elevation_gain_m = excluded.elevation_gain_m,
       calories = excluded.calories,
       avg_speed_mps = excluded.avg_speed_mps,
       fetched_at = excluded.fetched_at`
  );

  const writeAll = getDb().transaction((rows: ActivitySummary[]) => {
    for (const activity of rows) {
      statement.run(
        activity.activityId,
        activityDate(activity),
        activity.startTimeLocal,
        activity.name,
        activity.type,
        activity.distanceMeters,
        activity.durationSeconds,
        activity.averageHeartRate,
        activity.maxHeartRate,
        activity.elevationGainMeters,
        activity.calories,
        activity.averageSpeedMps,
        fetchedAt
      );
    }
  });

  writeAll(activities);
}

export function getActivitiesBetween(startDate: string, endDate: string): StoredActivity[] {
  return getDb()
    .prepare(
      `SELECT
         activity_id       AS activityId,
         date,
         start_time_local  AS startTimeLocal,
         name,
         type,
         distance_m        AS distanceMeters,
         duration_s        AS durationSeconds,
         avg_hr            AS avgHr,
         max_hr            AS maxHr,
         elevation_gain_m  AS elevationGainMeters,
         calories,
         avg_speed_mps     AS averageSpeedMps
       FROM activity
       WHERE date >= ? AND date <= ?
       ORDER BY start_time_local ASC`
    )
    .all(startDate, endDate) as StoredActivity[];
}

// SECTION: Stats

export function historyStats(): HistoryStats {
  const database = getDb();

  const count = (table: string): number =>
    (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;

  const span = database
    .prepare("SELECT MIN(date) AS oldest, MAX(date) AS newest FROM daily_metric")
    .get() as { oldest: string | null; newest: string | null };

  const emptyDays = (
    database
      .prepare("SELECT COUNT(*) AS count FROM ingest_day WHERE outcome = 'empty'")
      .get() as { count: number }
  ).count;

  return {
    metricRows: count("daily_metric"),
    rawRows: count("raw_payload"),
    activityRows: count("activity"),
    oldestDate: span.oldest,
    newestDate: span.newest,
    emptyDays,
  };
}
