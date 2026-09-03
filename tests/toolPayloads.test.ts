import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSleepPayload, renderSleepText } from "../src/tools/sleep.js";
import {
  buildActivitiesRangePayload,
  renderActivitiesRangeText,
  renderLatestActivityText,
} from "../src/tools/activities.js";
import { buildHeartRatePayload, renderHeartRateText } from "../src/tools/heartRate.js";
import { buildStressPayload, renderStressText } from "../src/tools/stress.js";
import { buildVo2MaxPayload, renderVo2MaxText } from "../src/tools/vo2Max.js";
import { renderRecoveryText } from "../src/tools/recovery.js";
import { renderTrainingInsightsText } from "../src/tools/trainingInsights.js";
import {
  buildBodyCompositionPayload,
  renderBodyCompositionText,
} from "../src/tools/bodyComposition.js";
import type {
  ActivitySummary,
  BodyCompositionEntry,
  SleepNightSummary,
} from "../src/garmin/types.js";

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
    const text = renderLatestActivityText({ activity: null, fromStore: false });

    assert.equal(text, "No activities found in your Garmin Connect account.");
  });

  it("renders the latest activity with every field intact", () => {
    const text = renderLatestActivityText({ activity: activity(), fromStore: false });

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

describe("heart rate payload", () => {
  it("takes the current resting HR from the newest day", () => {
    const payload = buildHeartRatePayload(
      [
        { date: "2026-08-19", restingHeartRate: 52, maxHeartRate: 171, minHeartRate: 46, averageHeartRate: 68 },
        { date: "2026-08-18", restingHeartRate: 50, maxHeartRate: 165, minHeartRate: 45, averageHeartRate: 66 },
      ],
      30
    );

    assert.equal(payload.currentResting, 52);
    assert.equal(payload.averageResting, 51);
    assert.equal(payload.recordedDays, 2);
  });

  it("renders the empty case with the requested day count", () => {
    assert.equal(
      renderHeartRateText(buildHeartRatePayload([], 30)),
      "No heart rate data found for the last 30 days."
    );
  });

  // The old renderer called Math.round(average([])) here and printed
  // "Average resting HR: NaN bpm".
  it("survives days that recorded no resting HR", () => {
    const payload = buildHeartRatePayload(
      [{ date: "2026-08-19", restingHeartRate: null, maxHeartRate: null, minHeartRate: null, averageHeartRate: 70 }],
      7
    );

    assert.equal(payload.currentResting, null);
    assert.equal(payload.averageResting, null);
    assert.match(renderHeartRateText(payload), /^Current resting HR: n\/a bpm$/m);
    assert.match(renderHeartRateText(payload), /^Average resting HR: n\/a bpm$/m);
  });
});

describe("stress payload", () => {
  it("averages only measured days", () => {
    const payload = buildStressPayload(
      [
        { date: "2026-08-19", averageStress: 34, maxStress: 88, restStress: null, stressDurationSeconds: null },
        { date: "2026-08-18", averageStress: null, maxStress: null, restStress: null, stressDurationSeconds: null },
        { date: "2026-08-17", averageStress: 30, maxStress: 80, restStress: null, stressDurationSeconds: null },
      ],
      7
    );

    assert.equal(payload.averageStress, 32);
    assert.equal(payload.recordedDays, 3);
  });

  it("renders the empty case", () => {
    assert.equal(
      renderStressText(buildStressPayload([], 7)),
      "No stress data found for the last 7 days."
    );
  });
});

describe("vo2 max payload", () => {
  it("reports current and oldest across the range", () => {
    const payload = buildVo2MaxPayload(
      [
        { date: "2026-08-19", vo2Max: 46, vo2MaxCycling: null },
        { date: "2026-07-19", vo2Max: 44, vo2MaxCycling: null },
      ],
      30
    );

    assert.equal(payload.current, 46);
    assert.equal(payload.oldest, 44);
    assert.equal(payload.recordedDays, 2);
  });

  it("renders the empty case", () => {
    assert.equal(
      renderVo2MaxText(buildVo2MaxPayload([], 30)),
      "No VO2 max data found for the last 30 days."
    );
  });
});

describe("recovery payload", () => {
  it("renders the score, status and every component", () => {
    const text = renderRecoveryText({
      date: "2026-08-19",
      storedThrough: null,
      recovery: {
        score: 91,
        status: "recovered",
        recommendation: "You look recovered. Hard training or a quality session is appropriate today.",
        components: { hrvScore: 95, sleepScore: 88, stressScore: 95, restingHrScore: 90 },
      },
    });

    assert.match(text, /^Recovery score: 91\/100 \(recovered\)$/m);
    assert.match(text, /^- HRV: 95$/m);
    assert.match(text, /^- Resting HR: 90$/m);
    assert.match(text, /^Date: 2026-08-19$/m);
  });
});

describe("body composition payload", () => {
  function entry(overrides: Partial<BodyCompositionEntry> = {}): BodyCompositionEntry {
    return {
      date: "2026-08-19",
      weightKg: 74.2,
      bodyFatPercent: 15.1,
      muscleMassKg: 60.4,
      bmi: 22.1,
      ...overrides,
    };
  }

  it("computes deltas between newest and oldest", () => {
    const payload = buildBodyCompositionPayload(
      [entry(), entry({ date: "2026-07-19", weightKg: 76.0, bodyFatPercent: 16.3 })],
      30
    );

    assert.equal(payload.weightDeltaKg?.toFixed(1), "-1.8");
    assert.equal(payload.bodyFatDeltaPercent?.toFixed(1), "-1.2");
    assert.equal(payload.current?.date, "2026-08-19");
    assert.equal(payload.baseline?.date, "2026-07-19");
  });

  it("returns null deltas when a value is missing", () => {
    const payload = buildBodyCompositionPayload(
      [entry({ weightKg: null }), entry({ date: "2026-07-19" })],
      30
    );

    assert.equal(payload.weightDeltaKg, null);
    assert.equal(payload.bodyFatDeltaPercent, 0);
  });

  it("renders the empty case", () => {
    assert.equal(
      renderBodyCompositionText(buildBodyCompositionPayload([], 30)),
      "No body composition data found for the last 30 days."
    );
  });
});

describe("training insights payload", () => {
  it("embeds each section under its own heading", () => {
    const text = renderTrainingInsightsText(
      {
        startDate: "2026-08-12",
        endDate: "2026-08-19",
        latest: null,
        activities: [],
        sleep: null,
        recovery: null,
        stress: null,
      },
      "SLEEP-SECTION",
      "RECOVERY-SECTION",
      "STRESS-SECTION"
    );

    assert.match(text, /^Training insights summary$/m);
    assert.match(text, /^Period: 2026-08-12 to 2026-08-19$/m);
    assert.match(text, /^## Latest activity\nNo activities found\.$/m);
    assert.match(text, /^No activities found between 2026-08-12 and 2026-08-19\.$/m);
    assert.match(text, /^## Sleep\nSLEEP-SECTION$/m);
    assert.match(text, /^## Recovery\nRECOVERY-SECTION$/m);
    assert.match(text, /^## Stress\nSTRESS-SECTION$/m);
  });

  it("numbers the activities in the period", () => {
    const text = renderTrainingInsightsText(
      {
        startDate: "2026-08-12",
        endDate: "2026-08-19",
        latest: activity(),
        activities: [activity(), activity({ name: "Evening Ride", type: "cycling" })],
        sleep: null,
        recovery: null,
        stress: null,
      },
      "",
      "",
      ""
    );

    assert.match(text, /^1\. Morning Run \(running\) — 2026-08-19 07:30:00$/m);
    assert.match(text, /^2\. Evening Ride \(cycling\) — 2026-08-19 07:30:00$/m);
    assert.match(text, /^## Latest activity\nActivity: Morning Run$/m);
  });
});
