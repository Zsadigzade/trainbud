import { DateTime } from "luxon";
import { getAppDb } from "./appDb.js";
import { getProfile } from "./profile.js";
import { logger } from "./utils/logger.js";

// SECTION: Usage — what the AI cost, and what actually gets used
//
// Two questions this project could not answer about itself.
//
// The first is what the AI spends. TrainBud is bring-your-own-key: every daily
// insight and every question asked from the wrist is charged to the user's own
// Anthropic account, and until now nothing counted them. A product that spends
// someone else's money without a running total is not finished.
//
// The second is which of nine cards anyone opens. Everything here stays on
// this machine -- there is no endpoint to send it to and no intention of
// adding one -- which is what makes it honest to have it on by default.
//
// One rule governs the whole file: an unknown price is null, never zero. A
// model this code has never heard of must not price to nothing, because a
// budget enforced against a silent zero is a budget that can never trip. Every
// aggregate carries the count of calls it could not price, and every surface
// that shows a total has to show that count beside it.

export type AiUsageKind = "ask" | "insight";
export type UsageSource = "watch" | "dashboard" | "cli" | "mcp" | "server";

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface AiUsageInput extends TokenCounts {
  kind: AiUsageKind;
  model: string;
  source: UsageSource;
  /** Unix seconds. Defaults to now; present so tests can place a call in time. */
  at?: number;
}

export interface AiUsageRow extends AiUsageInput {
  at: number;
  costUsd: number | null;
}

export interface AiSpend {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Calls whose model had no published price here. */
  unpricedCalls: number;
}

export interface BudgetState {
  capUsd: number | null;
  spentUsd: number;
  remainingUsd: number | null;
  exceeded: boolean;
  /** True when unpriced calls make `spentUsd` a floor rather than a total. */
  incomplete: boolean;
}

/**
 * Published per-million-token rates.
 *
 * Deliberately a small table of the models this product can actually be
 * pointed at, rather than a guess at a general pricing API. A model missing
 * from here is unpriced, and says so.
 */
const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
  "claude-opus-5": { input: 5.0, output: 25.0 },
};

/** Cache reads bill at about a tenth of fresh input; writes at about 1.25x. */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/** Cost in USD, or null when this model has no price here. */
export function priceOf(model: string, tokens: TokenCounts): number | null {
  const rate = PRICES_PER_MTOK[model];
  if (!rate) {
    return null;
  }
  const perToken = (perMTok: number) => perMTok / 1_000_000;
  return (
    tokens.inputTokens * perToken(rate.input) +
    tokens.outputTokens * perToken(rate.output) +
    (tokens.cacheReadTokens ?? 0) * perToken(rate.input) * CACHE_READ_MULTIPLIER +
    (tokens.cacheWriteTokens ?? 0) * perToken(rate.input) * CACHE_WRITE_MULTIPLIER
  );
}

export function recordAiUsage(input: AiUsageInput): AiUsageRow {
  const at = input.at ?? Math.floor(Date.now() / 1000);
  const costUsd = priceOf(input.model, input);

  const row: AiUsageRow = { ...input, at, costUsd };

  try {
    getAppDb()
      .prepare(
        `INSERT INTO ai_usage
           (at, kind, model, source, input_tokens, output_tokens,
            cache_read_tokens, cache_write_tokens, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        at,
        input.kind,
        input.model,
        input.source,
        input.inputTokens,
        input.outputTokens,
        input.cacheReadTokens ?? 0,
        input.cacheWriteTokens ?? 0,
        costUsd
      );
  } catch (err) {
    // Accounting must not take down the answer it was accounting for.
    logger.warn({ err }, "could not record AI usage");
  }

  return row;
}

export function aiSpendSince(sinceUnixSeconds: number): AiSpend {
  try {
    const row = getAppDb()
      .prepare(
        `SELECT COUNT(*)                                   AS calls,
                COALESCE(SUM(input_tokens), 0)             AS input_tokens,
                COALESCE(SUM(output_tokens), 0)            AS output_tokens,
                COALESCE(SUM(cost_usd), 0)                 AS cost_usd,
                COALESCE(SUM(cost_usd IS NULL), 0)         AS unpriced
           FROM ai_usage
          WHERE at >= ?`
      )
      .get(sinceUnixSeconds) as {
      calls: number;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
      unpriced: number;
    };

    return {
      calls: row.calls,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costUsd: row.cost_usd,
      unpricedCalls: row.unpriced,
    };
  } catch (err) {
    logger.warn({ err }, "could not read AI usage");
    return { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpricedCalls: 0 };
  }
}

/**
 * Spend since the first of the current month, in the user's own local time.
 *
 * A rolling thirty days would be a different and worse number: a monthly cap
 * that resets on a sliding window never resets, and the user compares this
 * against a bill that runs calendar months.
 */
export function monthToDateSpend(): AiSpend {
  const start = DateTime.local().startOf("month").toSeconds();
  return aiSpendSince(Math.floor(start));
}

export function budgetState(): BudgetState {
  const cap = getProfile().budget.monthlyUsd;
  const spend = monthToDateSpend();

  if (cap === null) {
    return {
      capUsd: null,
      spentUsd: spend.costUsd,
      remainingUsd: null,
      exceeded: false,
      incomplete: spend.unpricedCalls > 0,
    };
  }

  const remaining = Math.max(0, cap - spend.costUsd);
  return {
    capUsd: cap,
    spentUsd: spend.costUsd,
    remainingUsd: remaining,
    exceeded: spend.costUsd >= cap,
    incomplete: spend.unpricedCalls > 0,
  };
}

/** Thrown when a request is refused because the user's own cap is reached. */
export class BudgetExceededError extends Error {
  constructor(state: BudgetState) {
    super(
      `Monthly AI budget of $${state.capUsd?.toFixed(2)} reached ` +
        `($${state.spentUsd.toFixed(2)} spent). Raise or clear the cap in the dashboard.`
    );
  }
}

/** Throws when a cap is set and already reached. No cap means never throws. */
export function assertWithinBudget(): void {
  const state = budgetState();
  if (state.exceeded) {
    throw new BudgetExceededError(state);
  }
}

export interface AiUsageEntry {
  at: number;
  kind: string;
  model: string;
  source: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

/** The most recent calls, newest first — the ledger behind the total. */
export function recentAiUsage(limit = 20): AiUsageEntry[] {
  try {
    const rows = getAppDb()
      .prepare(
        `SELECT at, kind, model, source, input_tokens, output_tokens, cost_usd
           FROM ai_usage
          ORDER BY at DESC, id DESC
          LIMIT ?`
      )
      .all(limit) as {
      at: number;
      kind: string;
      model: string;
      source: string;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number | null;
    }[];

    return rows.map((row) => ({
      at: row.at,
      kind: row.kind,
      model: row.model,
      source: row.source,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costUsd: row.cost_usd,
    }));
  } catch (err) {
    logger.warn({ err }, "could not read recent AI usage");
    return [];
  }
}

export interface DailySpend {
  day: string;
  costUsd: number;
  calls: number;
}

/**
 * Cost per day for the last `days` days, including the days that cost nothing.
 *
 * The zero days are the point. A chart built only from rows that exist draws a
 * continuous line through a week the user never opened the app, which reads as
 * steady daily spend rather than as the four days it actually was.
 */
export function dailyAiSpend(days = 30): DailySpend[] {
  const today = DateTime.local().startOf("day");
  const byDay = new Map<string, DailySpend>();

  for (let i = days - 1; i >= 0; i -= 1) {
    const day = today.minus({ days: i }).toISODate();
    if (day) {
      byDay.set(day, { day, costUsd: 0, calls: 0 });
    }
  }

  try {
    const since = Math.floor(today.minus({ days: days - 1 }).toSeconds());
    const rows = getAppDb()
      .prepare("SELECT at, cost_usd FROM ai_usage WHERE at >= ?")
      .all(since) as { at: number; cost_usd: number | null }[];

    for (const row of rows) {
      const day = DateTime.fromSeconds(row.at).toISODate();
      const bucket = day ? byDay.get(day) : undefined;
      if (bucket) {
        bucket.costUsd += row.cost_usd ?? 0;
        bucket.calls += 1;
      }
    }
  } catch (err) {
    logger.warn({ err }, "could not read daily AI spend");
  }

  return [...byDay.values()];
}

export interface FeatureCount {
  name: string;
  count: number;
}

/**
 * Count one use of one feature, today.
 *
 * Everything about this is best-effort. It is called from render paths and
 * request handlers that have real work to do, and a counter that can throw is
 * a counter that takes down the feature it was measuring.
 */
export function recordFeature(name: string): void {
  try {
    if (!getProfile().analytics.enabled) {
      return;
    }
    const day = DateTime.local().toISODate();
    if (!day) {
      return;
    }
    const trimmed = name.slice(0, 64);
    getAppDb()
      .prepare(
        `INSERT INTO feature_usage (name, day, count) VALUES (?, ?, 1)
         ON CONFLICT(name, day) DO UPDATE SET count = count + 1`
      )
      .run(trimmed, day);
  } catch (err) {
    logger.warn({ err }, "could not record feature usage");
  }
}

export function featureCounts(days = 30): FeatureCount[] {
  try {
    const since = DateTime.local().minus({ days }).toISODate();
    if (!since) {
      return [];
    }
    return getAppDb()
      .prepare(
        `SELECT name, SUM(count) AS count
           FROM feature_usage
          WHERE day >= ?
          GROUP BY name
          ORDER BY count DESC, name ASC`
      )
      .all(since) as FeatureCount[];
  } catch (err) {
    logger.warn({ err }, "could not read feature usage");
    return [];
  }
}

/**
 * Delete every stored feature counter.
 *
 * Offered because "stop counting" and "forget what you counted" are different
 * requests, and a privacy control that only does the first is the kind that
 * gets described as a privacy control and is not one. AI spend is deliberately
 * NOT cleared here: that is the user's own billing record against a cap they
 * set, and losing it would make the cap wrong for the rest of the month.
 */
export function clearFeatureUsage(): void {
  try {
    getAppDb().prepare("DELETE FROM feature_usage").run();
  } catch (err) {
    logger.warn({ err }, "could not clear feature usage");
  }
}

/** Tests only. */
export function __clearUsageForTests(): void {
  const db = getAppDb();
  db.prepare("DELETE FROM ai_usage").run();
  db.prepare("DELETE FROM feature_usage").run();
}
