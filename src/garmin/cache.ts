import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { appConfig } from "../config.js";
import { hashParams } from "../utils/helpers.js";
import { logger } from "../utils/logger.js";

interface CacheRow {
  key: string;
  data: string;
  cached_at: number;
  ttl: number;
}

/**
 * Bumped whenever a cached value changes shape. The cache is keyed by tool and
 * parameters only, so without this a build that starts storing
 * `{ values, unreachableDays }` under a key that already holds a bare array
 * reads the old row back, casts it to the new type and dereferences a field
 * that is not there. An upgrade must invalidate, not reinterpret.
 */
const CACHE_SCHEMA_VERSION = "v2";

/**
 * How long a result that is missing days because requests FAILED may be kept.
 * A complete answer earns its full TTL; a degraded one gets long enough to stop
 * a retry storm and no longer.
 */
export const PARTIAL_CACHE_TTL_SECONDS = 60;

// SECTION: SQLite Cache

export class GarminCache {
  private readonly db: Database.Database;

  constructor(databasePath = appConfig.cachePath) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        cached_at INTEGER NOT NULL,
        ttl INTEGER NOT NULL
      )
    `);
  }

  buildKey(tool: string, params: Record<string, unknown>): string {
    return `${tool}:${CACHE_SCHEMA_VERSION}:${hashParams(params)}`;
  }

  get<T>(key: string): T | null {
    const row = this.db
      .prepare("SELECT key, data, cached_at, ttl FROM cache WHERE key = ?")
      .get(key) as CacheRow | undefined;

    if (!row) {
      return null;
    }

    const expiresAt = row.cached_at + row.ttl;
    if (Date.now() > expiresAt * 1000) {
      this.delete(key);
      return null;
    }

    try {
      return JSON.parse(row.data) as T;
    } catch (error) {
      logger.warn({ error, key }, "Failed to parse cached payload");
      this.delete(key);
      return null;
    }
  }

  set<T>(key: string, value: T, ttlSeconds: number): void {
    const cachedAt = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `
        INSERT INTO cache (key, data, cached_at, ttl)
        VALUES (@key, @data, @cached_at, @ttl)
        ON CONFLICT(key) DO UPDATE SET
          data = excluded.data,
          cached_at = excluded.cached_at,
          ttl = excluded.ttl
      `
      )
      .run({
        key,
        data: JSON.stringify(value),
        cached_at: cachedAt,
        ttl: ttlSeconds,
      });
  }

  delete(key: string): void {
    this.db.prepare("DELETE FROM cache WHERE key = ?").run(key);
  }

  clear(): number {
    const result = this.db.prepare("DELETE FROM cache").run();
    return result.changes;
  }

  stats(): { entries: number; expiredEntries: number } {
    const now = Math.floor(Date.now() / 1000);
    const entries = this.db.prepare("SELECT COUNT(*) as count FROM cache").get() as {
      count: number;
    };
    const expiredEntries = this.db
      .prepare("SELECT COUNT(*) as count FROM cache WHERE cached_at + ttl < ?")
      .get(now) as { count: number };

    return {
      entries: entries.count,
      expiredEntries: expiredEntries.count,
    };
  }

  close(): void {
    this.db.close();
  }
}

let cacheInstance: GarminCache | null = null;

export function getCache(): GarminCache {
  if (!cacheInstance) {
    cacheInstance = new GarminCache();
  }

  return cacheInstance;
}

export function closeCache(): void {
  if (cacheInstance) {
    cacheInstance.close();
    cacheInstance = null;
  }
}

export function buildToolCacheKey(tool: string, params: Record<string, unknown>): string {
  return getCache().buildKey(tool, params);
}

export interface CacheOptions<T> {
  /**
   * True when the value is incomplete because a request failed rather than
   * because nothing was measured. Such a value is cached for
   * `partialTtlSeconds`, not for the full TTL.
   */
  isPartial?: (value: T) => boolean;
  partialTtlSeconds?: number;
}

/**
 * A thrown fetcher caches nothing -- that has always been true and is the point
 * of the `await` sitting outside `cache.set`. What was not true is that a
 * fetcher which swallowed its own failures and returned an empty result got the
 * full success TTL, so one rate-limited minute froze "no data" in for two hours.
 * A caller that can tell the difference now says so through `isPartial`.
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  options: CacheOptions<T> = {}
): Promise<T> {
  const cache = getCache();
  const cached = cache.get<T>(key);

  if (cached !== null) {
    return cached;
  }

  const fresh = await fetcher();
  const partial = options.isPartial?.(fresh) ?? false;

  cache.set(
    key,
    fresh,
    partial ? (options.partialTtlSeconds ?? PARTIAL_CACHE_TTL_SECONDS) : ttlSeconds
  );

  return fresh;
}
