import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSleepPayload, renderSleepText } from "../src/tools/sleep.js";
import type { SleepNightSummary } from "../src/garmin/types.js";

function night(overrides: Partial<SleepNightSummary> = {}): SleepNightSummary {
  return {
    date: "2026-08-19",
    totalSleepSeconds: 22680,
    deepSleepSeconds: 4800,
    lightSleepSeconds: 13080,
    remSleepSeconds: 4800,
    awakeCount: 2,
    sleepScore: 78,
    avgSleepStress: 21,
    avgOvernightHrv: 44,
    hrvStatus: "BALANCED",
    ...overrides,
  };
}

describe("sleep payload", () => {
  it("carries the nights through untouched", () => {
    const payload = buildSleepPayload([night()], 7);

    assert.equal(payload.nights.length, 1);
    assert.equal(payload.nights[0]?.avgOvernightHrv, 44);
    assert.equal(payload.nights[0]?.hrvStatus, "BALANCED");
    assert.equal(payload.recordedNights, 1);
    assert.equal(payload.requestedNights, 7);
  });

  it("averages only the nights that scored", () => {
    const payload = buildSleepPayload(
      [
        night({ sleepScore: 80 }),
        night({ date: "2026-08-18", sleepScore: null }),
        night({ date: "2026-08-17", sleepScore: 60 }),
      ],
      7
    );

    assert.equal(payload.averageScore, 70);
    assert.equal(payload.recordedNights, 3);
  });

  it("reports a null average when nothing scored", () => {
    const payload = buildSleepPayload([night({ sleepScore: null })], 7);

    assert.equal(payload.averageScore, null);
  });

  it("renders the empty case with the requested night count", () => {
    const text = renderSleepText(buildSleepPayload([], 5));

    assert.equal(text, "No sleep data found for the last 5 nights.");
  });

  it("renders the header, average and per-night block exactly as before", () => {
    const text = renderSleepText(buildSleepPayload([night()], 7));

    assert.match(text, /^Sleep summary for last 1 recorded nights:$/m);
    assert.match(text, /^Average sleep score: 78$/m);
    assert.match(text, /^2026-08-19:$/m);
    assert.match(text, /^ {2}Total sleep: 6h 18m 0s$/m);
    assert.match(text, /^ {2}Score: 78 \| Awakenings: 2$/m);
  });
});
