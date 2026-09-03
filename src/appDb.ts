import Database from "better-sqlite3";
import { randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { appConfig } from "./config.js";
import { restrictExistingFile } from "./utils/secretFile.js";

// SECTION: App DB — settings, pair tokens, prompt jobs

const DB_PATH = path.resolve(
  path.dirname(appConfig.cachePath),
  "app.db"
);

export interface PairToken {
  code: string;
  created_at: number;
  expires_at: number;
  approved_at: number | null;
}

export interface PromptJob {
  id: string;
  prompt: string;
  status: "pending" | "running" | "done" | "error";
  result: string | null;
  error: string | null;
  created_at: number;
  completed_at: number | null;
}

let _db: Database.Database | null = null;

export const APP_DB_SCHEMA = `
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pair_tokens (
      code        TEXT PRIMARY KEY,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL,
      approved_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS prompt_jobs (
      id           TEXT PRIMARY KEY,
      prompt       TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      result       TEXT,
      error        TEXT,
      created_at   INTEGER NOT NULL,
      completed_at INTEGER
    );

    -- Usage. cost_usd is nullable ON PURPOSE: a model this build has no
    -- published price for records its tokens and leaves the cost unknown,
    -- because a call priced at zero is a monthly cap that can never trip.
    -- The schema lives here rather than in usage.ts so that opening the
    -- database does not have to import the module that writes to it.
    CREATE TABLE IF NOT EXISTS ai_usage (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      at            INTEGER NOT NULL,
      kind          TEXT    NOT NULL,
      model         TEXT    NOT NULL,
      source        TEXT    NOT NULL,
      input_tokens  INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd      REAL
    );
    CREATE INDEX IF NOT EXISTS ai_usage_at ON ai_usage(at);

    CREATE TABLE IF NOT EXISTS feature_usage (
      name  TEXT NOT NULL,
      day   TEXT NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (name, day)
    );
`;

function getDb(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new Database(DB_PATH);

  // This database holds the Anthropic API key the dashboard saves, in the clear.
  // better-sqlite3 creates the file, so it never went through writeSecretFile
  // and landed 0644 like any other SQLite file -- readable by every account on
  // the machine, while .env and session.json next to it are 0600.
  restrictExistingFile(DB_PATH);
  _db.exec(APP_DB_SCHEMA);

  // Reconciling used to happen here, which meant every process that opened this
  // file reclaimed every other process's in-flight work. See
  // reconcileStalePromptJobs.
  prunePromptJobs(_db);
  return _db;
}

/**
 * The open handle, for modules that own their own tables.
 *
 * `usage.ts` needs to read and write two tables of its own; routing that
 * through a per-statement wrapper here would put its SQL in a file that has
 * nothing to do with metering. The connection stays owned in one place -- this
 * hands out the handle, not a second one.
 */
export function getAppDb(): Database.Database {
  return getDb();
}

// Settings

export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

export function deleteSetting(key: string): void {
  getDb().prepare("DELETE FROM settings WHERE key = ?").run(key);
}

/** Setting keys starting with `prefix`, used to prune dated cache entries. */
export function listSettingKeys(prefix: string): string[] {
  const rows = getDb()
    .prepare("SELECT key FROM settings WHERE key LIKE ?")
    .all(`${prefix}%`) as { key: string }[];
  return rows.map((row) => row.key);
}

// Pair tokens

const PAIR_TOKEN_TTL_SECONDS = 5 * 60;

/**
 * A pair code is a bearer credential in disguise: /api/pair is unauthenticated
 * by design, and /api/pair/<code>/status hands out the API key as soon as that
 * code is approved. Math.random() was the source here, which means an attacker
 * who mints a handful of codes from the open endpoint can recover the PRNG
 * state and predict the code the real watch is displaying. randomInt draws from
 * the CSPRNG, uniformly and without modulo bias, and zero-padding keeps the
 * full six-digit space (including 000042) in play.
 */
export function generatePairCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function createPairToken(): PairToken {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + PAIR_TOKEN_TTL_SECONDS;

  // Clean expired tokens
  db.prepare("DELETE FROM pair_tokens WHERE expires_at < ?").run(now);

  let code = generatePairCode();
  let attempts = 0;
  while (attempts < 10) {
    const existing = db.prepare("SELECT code FROM pair_tokens WHERE code = ?").get(code);
    if (!existing) break;
    code = generatePairCode();
    attempts++;
  }

  const token: PairToken = { code, created_at: now, expires_at: expiresAt, approved_at: null };
  db.prepare("INSERT INTO pair_tokens (code, created_at, expires_at, approved_at) VALUES (?, ?, ?, NULL)")
    .run(code, now, expiresAt);
  return token;
}

export function getPairToken(code: string): PairToken | null {
  const row = getDb()
    .prepare("SELECT code, created_at, expires_at, approved_at FROM pair_tokens WHERE code = ?")
    .get(code) as PairToken | undefined;
  return row ?? null;
}

export function approvePairToken(code: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  const token = getPairToken(code);
  if (!token || token.expires_at < now) return false;

  getDb()
    .prepare("UPDATE pair_tokens SET approved_at = ? WHERE code = ?")
    .run(now, code);
  return true;
}

export function deletePairToken(code: string): void {
  getDb().prepare("DELETE FROM pair_tokens WHERE code = ?").run(code);
}

export function listPendingPairTokens(): PairToken[] {
  const now = Math.floor(Date.now() / 1000);
  return getDb()
    .prepare("SELECT code, created_at, expires_at, approved_at FROM pair_tokens WHERE expires_at > ? AND approved_at IS NULL ORDER BY created_at DESC")
    .all(now) as PairToken[];
}

// Prompt jobs

/** Kept long enough to answer "what did it say earlier today", not forever. */
const PROMPT_JOB_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * How old an unfinished job has to be before it counts as wreckage.
 *
 * The watch polls a job id for about thirty seconds and then gives up, so
 * anything younger than that is, or was until moments ago, an answer somebody
 * is waiting for. Five minutes leaves room for a slow model call as well.
 */
export const STALE_PROMPT_JOB_SECONDS = 5 * 60;

/**
 * A job the process died in the middle of is not still running.
 *
 * THIS USED TO RUN INSIDE `getDb()`, so the first time ANY process opened
 * app.db it flipped every pending and running row to
 * "The server stopped before this answer came back." -- including the rows
 * belonging to a `serve` that was, at that moment, waiting on Anthropic. Every
 * entry point opens this file, so asking a question on the watch and then
 * running `trainbud doctor`, `status`, `findings` or a backfill killed the live
 * answer from another process, and the watch drew "AI unavailable".
 *
 * Two changes, and both are needed. It is called once, from `serve` at startup,
 * so a CLI command no longer writes to a server's table at all. And it will not
 * touch a job younger than STALE_PROMPT_JOB_SECONDS, which is what protects a
 * second server on the same box, and a restart racing an answer that is still
 * in flight.
 */
export function reconcileStalePromptJobs(
  db: Database.Database,
  now = Math.floor(Date.now() / 1000)
): void {
  db.prepare(
    `UPDATE prompt_jobs
        SET status = 'error',
            error = 'The server stopped before this answer came back.',
            completed_at = ?
      WHERE status IN ('pending', 'running')
        AND created_at < ?`
  ).run(now, now - STALE_PROMPT_JOB_SECONDS);

  prunePromptJobs(db, now);
}

/** Drop rows past the retention window. Safe from any process. */
function prunePromptJobs(db: Database.Database, now = Math.floor(Date.now() / 1000)): void {
  db.prepare("DELETE FROM prompt_jobs WHERE created_at < ?").run(now - PROMPT_JOB_TTL_SECONDS);
}

/** Called once by `serve`, which is the only process that owns these jobs. */
export function reconcilePromptJobsOnStartup(): void {
  reconcileStalePromptJobs(getDb());
}

export function createPromptJob(id: string, prompt: string): PromptJob {
  const now = Math.floor(Date.now() / 1000);
  const job: PromptJob = { id, prompt, status: "pending", result: null, error: null, created_at: now, completed_at: null };
  const db = getDb();

  // Prune on write rather than on a timer: this table only grows when a job is
  // created, so this is the one place that needs to care, and it costs a single
  // indexed delete on a table with a handful of rows.
  db.prepare("DELETE FROM prompt_jobs WHERE created_at < ?").run(now - PROMPT_JOB_TTL_SECONDS);

  db.prepare("INSERT INTO prompt_jobs (id, prompt, status, result, error, created_at, completed_at) VALUES (?, ?, 'pending', NULL, NULL, ?, NULL)")
    .run(id, prompt, now);
  return job;
}

export function getPromptJob(id: string): PromptJob | null {
  const row = getDb()
    .prepare("SELECT id, prompt, status, result, error, created_at, completed_at FROM prompt_jobs WHERE id = ?")
    .get(id) as PromptJob | undefined;
  return row ?? null;
}

export function updatePromptJob(
  id: string,
  update: { status: PromptJob["status"]; result?: string; error?: string }
): void {
  const now = Math.floor(Date.now() / 1000);
  getDb()
    .prepare("UPDATE prompt_jobs SET status = ?, result = ?, error = ?, completed_at = ? WHERE id = ?")
    .run(
      update.status,
      update.result ?? null,
      update.error ?? null,
      update.status === "done" || update.status === "error" ? now : null,
      id
    );
}

export function closeAppDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
