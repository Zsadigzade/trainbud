// SECTION: History schema
//
// TrainBud's own copy of the Garmin record. Garmin remains the system of truth
// -- anything here can be re-fetched -- but nothing can be *asked* of data that
// was never kept, and the tool cache is TTL-keyed and deletes its own rows.
// Without this, every answer is derived from one day's numbers, which is the
// whole reason the app could only ever repeat what Connect already showed.

/**
 * One row per measurement. Sources that report several numbers for a day write
 * several rows.
 */
export type MetricKind =
  | "sleep_seconds"
  | "sleep_score"
  | "hrv_overnight"
  | "sleep_stress"
  | "resting_hr"
  | "max_hr"
  | "stress_avg"
  | "stress_max"
  | "vo2max"
  | "vo2max_cycling"
  | "weight_kg"
  | "body_fat_pct"
  | "muscle_mass_kg";

/** One Garmin endpoint family, fetched a day at a time. */
export type IngestSource =
  | "sleep"
  | "heart_rate"
  | "stress"
  | "vo2max"
  | "body_composition"
  | "activities";

/**
 * `data` -- the day was fetched and something was measured.
 * `empty` -- the day was fetched and Garmin has nothing, which is a final
 *            answer for any date outside the stale window: the watch was not
 *            worn and never will have been.
 * `error` -- the request failed. Retried on the next run.
 */
export type IngestOutcome = "data" | "empty" | "error";

/**
 * `daily_metric.value` is NOT NULL and a row exists only for a real
 * measurement, so "is there a row" answers "was this measured". The different
 * question -- "have we ever asked Garmin about this day" -- is what ingest_day
 * answers, and keeping the two apart is what stops a backfill from re-fetching
 * a year of days the user did not wear the watch.
 *
 * raw_payload is append-only. Garmin restates data (a sleep score finalizes
 * hours after waking, VO2 max is recomputed after a qualifying activity), and
 * an archive that overwrote would hide exactly the revision worth seeing. It is
 * also the insurance against a mapping bug: this project has twice read a field
 * Connect does not send, and re-deriving from the archive beats re-fetching a
 * year against an unofficial API.
 */
export const HISTORY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS daily_metric (
    date       TEXT    NOT NULL,
    kind       TEXT    NOT NULL,
    value      REAL    NOT NULL,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (date, kind)
  );

  CREATE TABLE IF NOT EXISTS raw_payload (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT    NOT NULL,
    source     TEXT    NOT NULL,
    fetched_at INTEGER NOT NULL,
    json       TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS raw_payload_date_source
    ON raw_payload (date, source, fetched_at);

  CREATE TABLE IF NOT EXISTS ingest_day (
    date       TEXT    NOT NULL,
    source     TEXT    NOT NULL,
    fetched_at INTEGER NOT NULL,
    outcome    TEXT    NOT NULL,
    PRIMARY KEY (date, source)
  );

  CREATE TABLE IF NOT EXISTS activity (
    activity_id      INTEGER PRIMARY KEY,
    date             TEXT    NOT NULL,
    start_time_local TEXT    NOT NULL,
    name             TEXT    NOT NULL,
    type             TEXT    NOT NULL,
    distance_m       REAL,
    duration_s       REAL,
    avg_hr           REAL,
    max_hr           REAL,
    elevation_gain_m REAL,
    calories         REAL,
    avg_speed_mps    REAL,
    fetched_at       INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS activity_date ON activity (date);
`;
