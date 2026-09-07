import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDefaultToolChecks, TOOLS_WITHOUT_LIVE_CHECK } from "../src/check.js";
import { listRegisteredToolNames } from "../src/tools/index.js";

/**
 * `trainbud check` describes itself as "Run live diagnostics against all
 * TrainBud tools", and it filters its own list down to tools that are actually
 * registered -- which protects against a check for a tool that no longer
 * exists, and does nothing about the opposite case. A registered tool that
 * nobody added a check for is simply never exercised, and the summary line
 * still reports every check passing.
 *
 * Measured before this test existed: the registry held 14 tools and `check`
 * exercised 9. `get_findings` and `get_week_review` -- the two the watch's Today
 * screen is built from -- were among the five it never called.
 *
 * This is the same fault `scripts/run-tests.mjs` was written to end for test
 * files: a hand-maintained list that silently forgets. A tool may be left out
 * of the live check, but it has to say so out loud and give a reason.
 */
describe("the live check accounts for every registered tool", () => {
  it("covers or explicitly excuses each one", () => {
    const covered = new Set(buildDefaultToolChecks().map((check) => check.name));
    const unaccounted = listRegisteredToolNames().filter(
      (name) => !covered.has(name) && !TOOLS_WITHOUT_LIVE_CHECK.has(name)
    );

    assert.deepEqual(
      unaccounted,
      [],
      "these tools are registered but never exercised by `trainbud check`"
    );
  });

  it("gives a reason for every tool it leaves out", () => {
    for (const [name, reason] of TOOLS_WITHOUT_LIVE_CHECK) {
      assert.ok(reason.trim().length > 0, `${name} is excluded without a reason`);
    }
  });

  it("does not excuse a tool that no longer exists", () => {
    const registered = new Set(listRegisteredToolNames());

    for (const name of TOOLS_WITHOUT_LIVE_CHECK.keys()) {
      assert.ok(registered.has(name), `${name} is excused but is not a registered tool`);
    }
  });

  it("keeps the write tools out of a diagnostic that users run casually", () => {
    // `check` is documented as diagnostics. Anything that mutates the user's
    // own history has to stay out of it, or running a health check would write
    // a fake session into their log.
    assert.ok(TOOLS_WITHOUT_LIVE_CHECK.has("remember_context"));
    assert.ok(TOOLS_WITHOUT_LIVE_CHECK.has("log_subjective"));
  });
});
