# History Store and Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TrainBud keeps its own year of Garmin history, so a question can be
answered from what actually happened rather than from today's four numbers.

**Architecture:** A separate `history.db` holds a normalized `daily_metric` table
for querying, an append-only `raw_payload` archive so a mapping fix can
re-derive history without re-fetching it, an `activity` table, and an
`ingest_day` checkpoint table that makes the backfill resumable. Ingest calls
per-date fetchers extracted from the tools, one request at a time with a
deliberate delay, newest date first so an interrupted run still leaves the most
useful data behind.

**Tech Stack:** TypeScript 6 (ESM, `.js` import extensions), better-sqlite3,
luxon, `node --test`.

**Spec:** `docs/superpowers/specs/2026-08-20-memory-layer.md`

**Depends on:** `docs/superpowers/plans/2026-08-20-structured-tool-output.md`
(complete — tools return typed payloads).

## Global Constraints

- Node >= 20. ESM only — every relative import ends in `.js`.
- New test files must be added to the `test` script in `package.json` or they
  do not run.
- `npm run typecheck` and `npm run lint` must pass before every commit.
- **The account is the thing at risk.** Ingest is sequential, one request in
  flight, with a delay between requests. No `mapInBatches`, no parallel fan-out.
  There is no appeal process if Garmin decides this looks like a scraper.
- Never write a Garmin credential, token, user id or profile id into
  `raw_payload` or into a committed fixture.
- `daily_metric` rows exist only for real measurements. Connect's `-1` (not
  worn) and `-2` (day in progress) are sentinels, not readings.

## Schema

```sql
CREATE TABLE daily_metric (
  date       TEXT    NOT NULL,   -- ISO yyyy-MM-dd, local calendar date
  kind       TEXT    NOT NULL,   -- see MetricKind
  value      REAL    NOT NULL,   -- a row exists only if it was measured
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (date, kind)
);

CREATE TABLE raw_payload (      -- append-only; revisions stay visible
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT    NOT NULL,
  source     TEXT    NOT NULL,
  fetched_at INTEGER NOT NULL,
  json       TEXT    NOT NULL
);

CREATE TABLE ingest_day (       -- the resumable checkpoint
  date       TEXT    NOT NULL,
  source     TEXT    NOT NULL,
  fetched_at INTEGER NOT NULL,
  outcome    TEXT    NOT NULL,  -- 'data' | 'empty' | 'error'
  PRIMARY KEY (date, source)
);

CREATE TABLE activity (
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
```

`MetricKind` is a closed union:

| Source | Kinds |
|---|---|
| `sleep` | `sleep_seconds`, `sleep_score`, `hrv_overnight`, `sleep_stress` |
| `heart_rate` | `resting_hr`, `max_hr` |
| `stress` | `stress_avg`, `stress_max` |
| `vo2max` | `vo2max`, `vo2max_cycling` |
| `body_composition` | `weight_kg`, `body_fat_pct`, `muscle_mass_kg` |

---

### Task 1: The history store

**Files:**
- Create: `src/history/schema.ts` (`MetricKind`, `IngestSource`, table DDL)
- Create: `src/history/store.ts`
- Create: `tests/historyStore.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `type MetricKind` / `type IngestSource` / `type IngestOutcome`
  - `openHistoryDb(path?: string): Database.Database` and `closeHistoryDb(): void`
  - `putMetrics(date: string, metrics: Array<{ kind: MetricKind; value: number }>, fetchedAt?: number): void`
  - `getMetricSeries(kind: MetricKind, startDate: string, endDate: string): Array<{ date: string; value: number }>`
  - `appendRawPayload(date: string, source: IngestSource, json: unknown, fetchedAt?: number): void`
  - `rawPayloadRevisions(date: string, source: IngestSource): Array<{ fetchedAt: number; json: string }>`
  - `markIngested(date: string, source: IngestSource, outcome: IngestOutcome, fetchedAt?: number): void`
  - `getIngestCheckpoint(date: string, source: IngestSource): { fetchedAt: number; outcome: IngestOutcome } | null`
  - `putActivities(activities: ActivitySummary[], fetchedAt?: number): void`
  - `getActivitiesBetween(startDate: string, endDate: string): StoredActivity[]`
  - `historyStats(): { metricRows: number; rawRows: number; activityRows: number; oldestDate: string | null; newestDate: string | null }`

- [ ] **Step 1: Write the failing test** — `tests/historyStore.test.ts` against a
  temp-file DB (`openHistoryDb(path)` with a path under `os.tmpdir()`, removed in
  `after`). Cases: a metric round-trips; a second `putMetrics` for the same
  `(date, kind)` overwrites the value and bumps `fetched_at`, leaving one row;
  `getMetricSeries` returns ascending dates and excludes anything outside the
  range; two `appendRawPayload` calls for the same `(date, source)` produce
  **two** rows, so a revision is visible; `markIngested` upserts and
  `getIngestCheckpoint` reads it back; `putActivities` is keyed on `activity_id`
  so re-ingesting the same activity does not duplicate it; `historyStats`
  reports the oldest and newest metric dates.

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Write `src/history/schema.ts`** — the two string unions and a
  `HISTORY_SCHEMA` DDL constant. Include a comment recording why `value` is
  `NOT NULL`: absence of a row means "not measured", which is distinct from
  "not fetched" — that second question is what `ingest_day` answers.

- [ ] **Step 4: Write `src/history/store.ts`** — lazy singleton in the shape of
  `src/appDb.ts:31-58`, defaulting to `history.db` beside `appConfig.cachePath`,
  with prepared statements per operation.

- [ ] **Step 5: Register the test, run it, typecheck, lint.**

- [ ] **Step 6: Commit** — `feat: a history store that keeps a year of Garmin data`

---

### Task 2: Per-date fetchers the tools and ingest both use

**Files:**
- Create: `src/garmin/daily.ts`
- Modify: `src/tools/sleep.ts` (delete `mapSleepData`, `fetchSleepNights` uses the new fetcher)
- Modify: `src/tools/heartRate.ts`, `src/tools/stress.ts`, `src/tools/vo2Max.ts`, `src/tools/bodyComposition.ts`
- Create: `tests/garminDaily.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `GarminConnectInstance` (`src/garmin/garminConnect.ts:16-26`), the
  existing mappers `mapDailyStress` / `mapMaxMetrics` (`src/garmin/rawApi.ts`)
- Produces, one per source, each returning the untouched response **and** the
  mapped row so ingest can archive one and store the other:
  - `fetchSleepDay(client, date): Promise<DailyFetch<SleepNightSummary>>`
  - `fetchHeartRateDay(client, date): Promise<DailyFetch<HeartRateDaySummary>>`
  - `fetchStressDay(client, date): Promise<DailyFetch<DailyStressSummary>>`
  - `fetchVo2MaxDay(client, date): Promise<DailyFetch<Vo2MaxEntry>>`
  - `fetchBodyCompositionDay(client, date): Promise<DailyFetch<BodyCompositionEntry[]>>`
  - `interface DailyFetch<T> { raw: unknown; mapped: T | null }`
  - `mapSleepData(date: Date, payload: SleepData): SleepNightSummary | null` (moved out of `sleep.ts`, now exported)
  - `mapHeartRateData(date: Date, payload: HeartRateData): HeartRateDaySummary | null` (moved out of `heartRate.ts`)
  - `mapWeightData(date: Date, payload: WeightDataResponse): BodyCompositionEntry[]` (moved out of `bodyComposition.ts`)

**Why:** ingest must not re-implement the mapping. Two copies of "which field is
the average stress" is exactly how `overallStressLevel` shipped: a mapper reading
a field Connect does not send, with a test written against the same invented
shape.

- [ ] **Step 1: Write the failing test** — `tests/garminDaily.test.ts` drives each
  fetcher with a hand-rolled fake `GarminConnectInstance` (an object literal cast
  through `unknown`; only the method under test needs a real implementation).
  Assert each returns `raw` identical to what the fake returned **and** a
  correctly mapped row; assert a response with no `dailySleepDTO` maps to `null`
  while still returning its `raw`.

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Write `src/garmin/daily.ts`**, moving `mapSleepData`,
  the heart rate sample-averaging block and the weight-list map in verbatim.

- [ ] **Step 4: Rewire the five tools** to call the new fetchers inside their
  existing `mapInBatches` loops. The tools' batching is unchanged — they serve
  interactive requests and are not the thing that must be gentle.

- [ ] **Step 5: Verify** — the full suite must still pass unchanged, including
  `tests/toolTextContract.test.ts`. That file is the proof the move changed
  nothing a client can see.

- [ ] **Step 6: Commit** — `refactor: per-date fetchers shared by the tools and ingest`

---

### Task 3: The ingest engine

**Files:**
- Create: `src/history/ingest.ts`
- Create: `tests/historyIngest.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2
- Produces:
  - `interface IngestOptions { days?: number; delayMs?: number; sources?: IngestSource[]; now?: DateTime; signal?: AbortSignal; onProgress?: (p: IngestProgress) => void }`
  - `interface IngestProgress { date: string; source: IngestSource; outcome: IngestOutcome; done: number; total: number }`
  - `interface IngestResult { fetched: number; skipped: number; errors: number; firstDate: string | null; lastDate: string | null }`
  - `pendingWork(options: IngestOptions): Array<{ date: string; source: IngestSource }>`
  - `runIngest(client: GarminConnectInstance, options?: IngestOptions): Promise<IngestResult>`

**Ordering and staleness — the two rules that make this correct:**

1. **Newest date first.** A backfill that is killed halfway should leave the most
   recent year-to-date behind, not the oldest.
2. **The last three days are never final.** A sleep score finalizes hours after
   waking, VO2 max is recomputed after a qualifying activity, and Connect reports
   `-2` for a day still in progress. So a date within `STALE_WINDOW_DAYS` of
   today is re-fetched even when it already has a checkpoint, provided that
   checkpoint is older than `STALE_RECHECK_SECONDS`. Older dates with any
   checkpoint — including `empty` — are skipped forever. Without the `empty`
   skip, every run would re-fetch the same year of days the user did not wear the
   watch.

- [ ] **Step 1: Write the failing test** — a fake client counting calls per method,
  with `delayMs: 0` throughout. Cases: `pendingWork` returns `days × sources`
  entries on an empty DB, newest date first; after a full run, a second
  `pendingWork` returns only the dates inside the stale window; an `empty`
  outcome on an old date is not retried; a fetcher that throws records an
  `error` outcome and the run continues to the next date rather than aborting;
  `runIngest` writes both `daily_metric` rows and `raw_payload` rows; the
  sentinel case — a stress payload of `avgStressLevel: -1` writes **no**
  `stress_avg` row but still records the day as ingested; an `AbortSignal`
  already aborted stops before the first request.

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Write `src/history/ingest.ts`.** One request in flight; `await`
  a delay between requests; `markIngested` after every date so a kill resumes
  where it stopped; wrap each fetch in try/catch so one bad day cannot end the
  run.

- [ ] **Step 4: Verify, then commit** — `feat: resumable, rate-gentle Garmin backfill`

---

### Task 4: Wiring — `trainbud backfill`, catch-up on serve, hourly refresh

**Files:**
- Modify: `src/cli.ts` (new `backfill` command, `status` reports history)
- Modify: `src/httpServer.ts` (catch-up on start, hourly timer, `unref`)
- Create: `tests/historyScheduler.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `startHistoryScheduler(options?: { intervalMs?: number; run?: () => Promise<unknown> }): () => void` in `src/history/scheduler.ts` — returns its own stop function

**The three things that must be true of the scheduler:**

1. Its timer is `unref()`d. A referenced interval keeps the event loop open, and
   that is precisely the bug fixed in `802d4d8` — do not reintroduce it in a
   different shape.
2. Runs do not overlap. If an ingest is still going when the interval fires, the
   tick is skipped, not queued.
3. A failing ingest is logged and swallowed. It must never take the HTTP server
   down — the watch depends on that process staying up.

- [ ] **Step 1: Write the failing test** — inject a fake `run` and a short
  `intervalMs`. Assert: it runs on start; a second tick while the first is still
  pending is skipped; a rejecting `run` does not throw out of the scheduler; the
  returned stop function prevents further runs.

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Write `src/history/scheduler.ts`.**

- [ ] **Step 4: Add the `backfill` command** — `--days`, `--delay-ms`,
  `--source`, printing progress per date and a summary line. Extend `status` with
  the history row counts and date range from `historyStats()`.

- [ ] **Step 5: Start the scheduler from `serve`**, and stop it in the server's
  close path alongside the existing shutdown.

- [ ] **Step 6: Verify, then commit** — `feat: backfill command and hourly catch-up while serving`

---

### Task 5: Real payloads as fixtures

**Files:**
- Create: `src/history/capture.ts` (redaction)
- Create: `tests/fixtures/README.md`
- Create: `tests/captureRedaction.test.ts`
- Modify: `src/cli.ts` (`backfill --capture <dir>`)
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `const REDACTED_KEYS: string[]`
  - `redactPayload(payload: unknown): unknown` — deep clone with identifier
    fields replaced, arrays and value fields untouched
  - `writeFixture(dir: string, source: IngestSource, date: string, payload: unknown): string`

**Why:** the stress mapper shipped broken because its test was written against a
payload nobody had ever received. `tests/rawApi.test.ts:20-30` already carries
the note. Detectors are far more elaborate than that mapper, and the raw archive
means these payloads are being captured anyway.

- [ ] **Step 1: Write the failing test** — `redactPayload` replaces
  `userProfilePK`, `userProfileId`, `userId`, `displayName`, `fullName`,
  `email`, `ownerId`, `ownerDisplayName` and any key ending in `Token`; leaves
  every numeric measurement untouched; recurses into nested objects and arrays;
  does not mutate its input; survives `null` and a primitive.

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Write `src/history/capture.ts`.**

- [ ] **Step 4: Add `--capture <dir>` to `backfill`**, writing one redacted JSON
  file per `(source, date)`.

- [ ] **Step 5: Write `tests/fixtures/README.md`** — how to capture, what must be
  scrubbed before committing, and the standing rule that a fixture is only worth
  having if it came off the wire.

- [ ] **Step 6: Verify, then commit** — `feat: capture real Garmin payloads as redacted fixtures`

**Left to a human:** running `backfill --capture` against the real account and
committing the resulting files. Nothing generated by this plan may be committed
as a fixture without a person having read it first.

---

## What this unblocks

Plan 3's detectors read `getMetricSeries('resting_hr', …)` for a 28-day personal
baseline, `getActivitiesBetween(…)` for the TRIMP load series, and
`getMetricSeries('hrv_overnight', …)` for the trend break — all pure queries
against local SQLite, so every detector test is a fixture and an assertion with
no network in sight.
