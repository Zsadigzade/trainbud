import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSleepPayload, renderSleepText } from "../src/tools/sleep.js";
import {
  buildActivitiesRangePayload,
  renderActivitiesRangeText,
  renderLatestActivityText,
} from "../src/tools/activities.js";
import type { ActivitySummary, SleepNightSummary } from "../src/garmin/types.js";

function activity(overrides: Partial<ActivitySummary> = {}): ActivitySummary {
  return {
    activityId: 1,
    name: "Morning Run",
    type: "running",
    startTimeLocal: "2026-08-19 07:30:00",
    distanceMeters: 5200,
    durationSeconds: 1920,
    averageHeartRate: 148,
    maxHeartRate: 171,
    elevationGainMeters: 42,
    calories: 310,
    averageSpeedMps: 2.7,
    ...overrides,
  };
}

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

describe("activity payloads", () => {
  it("renders the no-activities case for the latest tool", () => {
    const text = renderLatestActivityText({ activity: null });

    assert.equal(text, "No activities found in your Garmin Connect account.");
  });

  it("renders the latest activity with every field intact", () => {
    const text = renderLatestActivityText({ activity: activity() });

    assert.match(text, /^Activity: Morning Run$/m);
    assert.match(text, /^Avg HR: 148 bpm$/m);
  });

  it("reports the range and the truncation flag", () => {
    const payload = buildActivitiesRangePayload([activity()], "2026-08-01", "2026-08-19", true);

    assert.equal(payload.activities.length, 1);
    assert.equal(payload.activities[0]?.distanceMeters, 5200);
    assert.equal(payload.truncated, true);
    assert.equal(payload.startDate, "2026-08-01");
    assert.equal(payload.endDate, "2026-08-19");
  });

  it("renders the empty range with both dates", () => {
    const text = renderActivitiesRangeText(
      buildActivitiesRangePayload([], "2026-08-01", "2026-08-19", false)
    );

    assert.equal(text, "No activities found between 2026-08-01 and 2026-08-19.");
  });

  it("appends the truncation note only when truncated", () => {
    const truncated = renderActivitiesRangeText(
      buildActivitiesRangePayload([activity()], "2026-08-01", "2026-08-19", true)
    );
    assert.match(truncated, /only the most recent 500 activities were scanned/);

    const complete = renderActivitiesRangeText(
      buildActivitiesRangePayload([activity()], "2026-08-01", "2026-08-19", false)
    );
    assert.doesNotMatch(complete, /500 activities/);
  });
});
