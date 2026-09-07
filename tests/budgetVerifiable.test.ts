import { describe, it, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same redirect as tests/usage.test.ts: appDb resolves its path at import.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-budget-"));
process.env.TRAINBUD_CACHE_PATH = path.join(dir, "cache.db");

let usage: typeof import("../src/usage.js");
let profile: typeof import("../src/profile.js");
let appDb: typeof import("../src/appDb.js");

/**
 * A cap the app cannot verify is not a cap.
 *
 * `aiSpendSince` reads the usage table inside a try/catch and, on any failure,
 * returned zeros. Every caller then read "you have spent $0.00 this month":
 * `budgetState` reported `exceeded: false`, `assertWithinBudget` allowed the
 * call, and the watch drew a budget that was fine. A locked or damaged
 * `app.db` was therefore indistinguishable from a month with no spending in
 * it -- and the difference is the user's own money, on a feature whose entire
 * promise is that it refuses rather than spends past a limit they set.
 *
 * Failing closed everywhere would be worse: someone with no cap set has asked
 * for no limit, and a transient read failure must not take their AI features
 * away. So the rule is narrow -- refuse only when a cap exists and the spend
 * behind it cannot be read.
 */
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

/** The store becoming unreadable, which is what a damaged app.db looks like here. */
function makeUsageUnreadable(): void {
  appDb.getAppDb().exec("DROP TABLE ai_usage");
}

describe("a budget cap that cannot be verified", () => {
  it("does not report an unreadable store as zero spend", () => {
    profile.updateProfile({ budget: { monthlyUsd: 5 } });
    usage.recordAiUsage({
      kind: "ask",
      model: "claude-haiku-4-5",
      inputTokens: 1000,
      outputTokens: 1000,
      source: "watch",
    });

    makeUsageUnreadable();
    const state = usage.budgetState();

    assert.equal(state.spendUnknown, true, "the read failed and the state has to say so");
    assert.equal(state.incomplete, true, "anything drawing this must show the caveat");
  });

  it("refuses a call when a cap is set and the spend behind it cannot be read", () => {
    profile.updateProfile({ budget: { monthlyUsd: 5 } });
    makeUsageUnreadable();

    assert.throws(
      () => usage.assertWithinBudget(),
      (error: unknown) => {
        assert.ok(error instanceof usage.BudgetUnverifiableError, "wrong error type");
        // Not the "you have spent your limit" message: nobody knows what was spent.
        assert.match(String((error as Error).message), /verif/i);
        return true;
      }
    );
  });

  it("still allows the call when the user set no cap at all", () => {
    // No cap means no limit was asked for; a read failure must not remove a
    // feature the user is entitled to.
    makeUsageUnreadable();

    assert.doesNotThrow(() => usage.assertWithinBudget());
  });

  it("leaves the ordinary path alone", () => {
    profile.updateProfile({ budget: { monthlyUsd: 5 } });

    const state = usage.budgetState();

    assert.equal(state.spendUnknown, false);
    assert.equal(state.exceeded, false);
    assert.doesNotThrow(() => usage.assertWithinBudget());
  });
});
