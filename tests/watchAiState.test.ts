import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildWatchSummaryFrom } from "../src/watchApi.js";

// The watch drew "AI unavailable" whether AI had never been set up or a live
// call had failed. Those need different actions from the user, and the payload
// carried nothing to tell them apart: ai_insight is null in both cases.
//
// Reproduced from this install: the only two prompt jobs ever created both
// failed with "ANTHROPIC_API_KEY not configured", and the watch said
// "AI unavailable" -- which is true, and says nothing about the key.

const EMPTY_PARTS = {
  recovery: null,
  sleep: null,
  activity: null,
  stress: null,
  vo2max: null,
  heartRate: null,
  findings: [],
  coverage: { days: 0, ready: false },
  context: [],
  updatedAt: "2026-09-02T20:00:00.000Z",
};

describe("AI availability on the watch payload", () => {
  it("reports AI as unconfigured when no key is set", () => {
    const summary = buildWatchSummaryFrom({ ...EMPTY_PARTS, aiConfigured: false });
    assert.equal(summary.ai_configured, false);
  });

  it("reports AI as configured when a key is set", () => {
    const summary = buildWatchSummaryFrom({ ...EMPTY_PARTS, aiConfigured: true });
    assert.equal(summary.ai_configured, true);
  });

  it("does not disturb the rest of the payload", () => {
    const summary = buildWatchSummaryFrom({ ...EMPTY_PARTS, aiConfigured: false });
    assert.equal(summary.coverage.days, 0);
    assert.equal(summary.prompts.length > 0, true);
    assert.equal(summary.updated_at, "2026-09-02T20:00:00.000Z");
  });
});
