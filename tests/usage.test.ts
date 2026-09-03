import { describe, it, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DateTime } from "luxon";

// See tests/profile.test.ts for why the redirect happens once, at module scope,
// and the directory outlives the file: appDb resolves its path at import.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-usage-"));
process.env.TRAINBUD_CACHE_PATH = path.join(dir, "cache.db");

let usage: typeof import("../src/usage.js");
let profile: typeof import("../src/profile.js");
let appDb: typeof import("../src/appDb.js");

beforeEach(async () => {
  usage = await import("../src/usage.js");
  profile = await import("../src/profile.js");
  appDb = await import("../src/appDb.js");
  appDb.deleteSetting("profile");
  profile.__resetProfileCacheForTests();
  usage.__clearUsageForTests();
});

afterEach(() => {
  appDb.closeAppDb();
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.TRAINBUD_CACHE_PATH;
});

describe("AI pricing", () => {
  it("prices a haiku call at the published rate", () => {
    // $1.00 per 1M input, $5.00 per 1M output.
    const row = usage.recordAiUsage({
      kind: "ask",
      model: "claude-haiku-4-5",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      source: "watch",
    });
    assert.ok(row.costUsd !== null);
    assert.ok(Math.abs((row.costUsd as number) - 6.0) < 1e-6, `got ${row.costUsd}`);
  });

  it("prices cache reads far below fresh input", () => {
    const fresh = usage.priceOf("claude-haiku-4-5", {
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    const cached = usage.priceOf("claude-haiku-4-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
    });
    assert.ok(fresh !== null && cached !== null);
    assert.ok((cached as number) < (fresh as number) / 5);
  });

  it("returns null for a model it has no price for, never zero", () => {
    // A model priced at zero is a budget that can never trip. An unknown price
    // has to stay unknown all the way to the surface that reports it.
    assert.equal(
      usage.priceOf("some-model-shipped-after-this-code", {
        inputTokens: 1000,
        outputTokens: 1000,
      }),
      null
    );
  });

  it("records an unpriced call with null cost and counts it separately", () => {
    usage.recordAiUsage({
      kind: "ask",
      model: "unknown-model",
      inputTokens: 500,
      outputTokens: 500,
      source: "watch",
    });
    const summary = usage.aiSpendSince(0);
    assert.equal(summary.calls, 1);
    assert.equal(summary.unpricedCalls, 1);
    assert.equal(summary.costUsd, 0);
    assert.equal(summary.outputTokens, 500);
  });
});

describe("spend windows", () => {
  it("totals only calls inside the window", () => {
    const now = Math.floor(Date.now() / 1000);
    usage.recordAiUsage({
      kind: "ask", model: "claude-haiku-4-5",
      inputTokens: 1_000_000, outputTokens: 0, source: "watch", at: now - 10_000,
    });
    usage.recordAiUsage({
      kind: "ask", model: "claude-haiku-4-5",
      inputTokens: 1_000_000, outputTokens: 0, source: "watch", at: now,
    });
    assert.equal(usage.aiSpendSince(now - 100).calls, 1);
    assert.equal(usage.aiSpendSince(0).calls, 2);
  });

  it("counts the month from the first of the month, not the last 30 days", () => {
    const startOfMonth = DateTime.local().startOf("month");
    const dayBefore = startOfMonth.minus({ days: 1 }).toSeconds();

    usage.recordAiUsage({
      kind: "ask", model: "claude-haiku-4-5",
      inputTokens: 1_000_000, outputTokens: 0, source: "watch",
      at: Math.floor(dayBefore),
    });
    usage.recordAiUsage({
      kind: "ask", model: "claude-haiku-4-5",
      inputTokens: 1_000_000, outputTokens: 0, source: "watch",
    });

    assert.equal(usage.monthToDateSpend().calls, 1);
  });
});

describe("AI budget", () => {
  it("reports no cap when the user has not set one", () => {
    const state = usage.budgetState();
    assert.equal(state.capUsd, null);
    assert.equal(state.exceeded, false);
    assert.equal(state.remainingUsd, null);
  });

  it("does not block while spend is under the cap", () => {
    profile.updateProfile({ budget: { monthlyUsd: 1 } });
    usage.recordAiUsage({
      kind: "ask", model: "claude-haiku-4-5",
      inputTokens: 100_000, outputTokens: 0, source: "watch",
    });
    assert.equal(usage.budgetState().exceeded, false);
    assert.doesNotThrow(() => usage.assertWithinBudget());
  });

  it("blocks once spend reaches the cap", () => {
    profile.updateProfile({ budget: { monthlyUsd: 1 } });
    usage.recordAiUsage({
      kind: "ask", model: "claude-haiku-4-5",
      inputTokens: 1_000_000, outputTokens: 0, source: "watch",
    });
    const state = usage.budgetState();
    assert.equal(state.exceeded, true);
    assert.equal(state.remainingUsd, 0);
    assert.throws(() => usage.assertWithinBudget(), /budget/i);
  });

  it("never blocks when the user has set no cap, however much was spent", () => {
    usage.recordAiUsage({
      kind: "ask", model: "claude-opus-5",
      inputTokens: 50_000_000, outputTokens: 50_000_000, source: "watch",
    });
    assert.doesNotThrow(() => usage.assertWithinBudget());
  });

  it("says so when unpriced calls make the total a floor rather than a total", () => {
    // Spend we could not price is spend we cannot see. A cap enforced against
    // a number known to be incomplete has to admit that in the same breath.
    profile.updateProfile({ budget: { monthlyUsd: 5 } });
    usage.recordAiUsage({
      kind: "ask", model: "unknown-model",
      inputTokens: 1000, outputTokens: 1000, source: "watch",
    });
    assert.equal(usage.budgetState().incomplete, true);
  });
});

describe("feature analytics", () => {
  it("counts an event per day", () => {
    usage.recordFeature("card.today");
    usage.recordFeature("card.today");
    usage.recordFeature("card.week");
    const counts = usage.featureCounts(30);
    assert.equal(counts.find((c) => c.name === "card.today")?.count, 2);
    assert.equal(counts.find((c) => c.name === "card.week")?.count, 1);
  });

  it("records nothing while the user has analytics switched off", () => {
    profile.updateProfile({ analytics: { enabled: false } });
    usage.recordFeature("card.today");
    assert.deepEqual(usage.featureCounts(30), []);
  });

  it("never throws on a surface that is only trying to count something", () => {
    // Counting is a side errand. A failure here must not take down the request
    // that happened to be carrying it.
    assert.doesNotThrow(() => usage.recordFeature("x".repeat(500)));
  });
});
