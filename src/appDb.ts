import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { appConfig } from "./config.js";

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

function getDb(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new Database(DB_PATH);
  _db.exec(`
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
  `);
  return _db;
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

function randomCode(): string {
  const digits = "0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += digits[Math.floor(Math.random() * digits.length)];
  }
  return code;
}

export function createPairToken(): PairToken {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + PAIR_TOKEN_TTL_SECONDS;

  // Clean expired tokens
  db.prepare("DELETE FROM pair_tokens WHERE expires_at < ?").run(now);

  let code = randomCode();
  let attempts = 0;
  while (attempts < 10) {
    const existing = db.prepare("SELECT code FROM pair_tokens WHERE code = ?").get(code);
    if (!existing) break;
    code = randomCode();
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

export function createPromptJob(id: string, prompt: string): PromptJob {
  const now = Math.floor(Date.now() / 1000);
  const job: PromptJob = { id, prompt, status: "pending", result: null, error: null, created_at: now, completed_at: null };
  getDb()
    .prepare("INSERT INTO prompt_jobs (id, prompt, status, result, error, created_at, completed_at) VALUES (?, ?, 'pending', NULL, NULL, ?, NULL)")
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
