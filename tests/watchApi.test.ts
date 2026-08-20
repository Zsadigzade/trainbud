import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildWatchSummaryFrom,
  toWatchActivity,
  toWatchHeartRate,
  toWatchRecovery,
  toWatchSleep,
  toWatchStress,
  toWatchVo2Max,
} from "../src/watchApi.js";
import type { RecoveryPayload } from "../src/tools/payloads.js";

function recoveryPayload(
  score: number,
  status: RecoveryPayload["recovery"]["status"]
): RecoveryPayload {
  return {
    date: "2026-08-19",
    recovery: {
      score,
      status,
      recommendation: "",
      components: { hrvScore: 95, sleepScore: 88, stressScore: 95, restingHrScore: 90 },
    },
  };
}

describe("watch mappers", () => {
  it("labels recovery by status, not by score", () => {
    assert.deepEqual(toWatchRecovery(recoveryPayload(91, "recovered")), {
      score: 91,
      label: "Ready",
    });
    assert.equal(toWatchRecovery(recoveryPayload(70, "good"))?.label, "Light");
    assert.equal(toWatchRecovery(recoveryPayload(55, "fatigued"))?.label, "Rest");
    assert.equal(toWatchRecovery(null), null);
  });

  it("converts sleep seconds to one decimal hour", () => {
    const sleep = toWatchSleep({
      requestedNights: 1,
      recordedNights: 1,
      averageScore: 78,
      nights: [
        {
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
        },
      ],
    });

    assert.equal(sleep?.hours, 6.3);
    assert.equal(sleep?.score, 78);
    assert.equal(sleep?.label, "Good");
  });

  it("returns null sleep when no night was recorded", () => {
    assert.equal(
      toWatchSleep({ requestedNights: 1, recordedNights: 0, averageScore: null, nights: [] }),
      null
    );
    assert.equal(toWatchSleep(null), null);
  });

  it("converts activity metres to kilometres and seconds to minutes", () => {
    const activity = toWatchActivity({
      activity: {
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
      },
    });

    assert.equal(activity?.name, "Morning Run");
    assert.equal(activity?.distance_km, 5.2);
    assert.equal(activity?.duration_min, 32);
    assert.equal(activity?.avg_hr, 148);
    assert.equal(activity?.date, "2026-08-19 07:30:00");
  });

  // Strength training reports no distance at all. The regex parser recovered
  // distance by matching "Distance: 5.20 km" and fell through to null here too,
  // but it also had to guess between a km line and a metres line.
  it("keeps a distanceless activity rather than dropping it", () => {
    const activity = toWatchActivity({
      activity: {
        activityId: 2,
        name: "Strength",
        type: "strength_training",
        startTimeLocal: "2026-08-18 18:00:00",
        distanceMeters: null,
        durationSeconds: 2700,
        averageHeartRate: 112,
        maxHeartRate: 150,
        elevationGainMeters: null,
        calories: 260,
        averageSpeedMps: null,
      },
    });

    assert.equal(activity?.name, "Strength");
    assert.equal(activity?.distance_km, null);
    assert.equal(activity?.duration_min, 45);
  });

  it("returns null for every mapper when the payload carries no measurement", () => {
    assert.equal(toWatchActivity({ activity: null }), null);
    assert.equal(toWatchActivity(null), null);
    assert.equal(
      toWatchStress({ requestedDays: 7, recordedDays: 0, averageStress: null, trend: "stable", days: [] }),
      null
    );
    assert.equal(
      toWatchVo2Max({ requestedDays: 30, recordedDays: 0, current: null, oldest: null, trend: "stable", entries: [] }),
      null
    );
    assert.equal(
      toWatchHeartRate({ requestedDays: 7, recordedDays: 0, currentResting: null, averageResting: null, trend: "stable", days: [] }),
      null
    );
  });

  it("labels stress by the same thresholds as before", () => {
    const label = (avg: number) =>
      toWatchStress({ requestedDays: 7, recordedDays: 1, averageStress: avg, trend: "stable", days: [] })
        ?.label;

    assert.equal(label(20), "Low");
    assert.equal(label(25), "Low");
    assert.equal(label(34), "Medium");
    assert.equal(label(50), "Medium");
    assert.equal(label(61), "High");
  });

  it("reads the max heart rate off the newest day", () => {
    const heartRate = toWatchHeartRate({
      requestedDays: 7,
      recordedDays: 2,
      currentResting: 52,
      averageResting: 51,
      trend: "stable",
      days: [
        { date: "2026-08-19", restingHeartRate: 52, maxHeartRate: 171, minHeartRate: 46, averageHeartRate: 68 },
        { date: "2026-08-18", restingHeartRate: 50, maxHeartRate: 165, minHeartRate: 45, averageHeartRate: 66 },
      ],
    });

    assert.equal(heartRate?.resting, 52);
    assert.equal(heartRate?.max, 171);
  });

  it("fills the overview grid from the mapped cards and leaves absent ones null", () => {
    const summary = buildWatchSummaryFrom({
      recovery: recoveryPayload(91, "recovered"),
      sleep: null,
      activity: null,
      stress: { requestedDays: 7, recordedDays: 1, averageStress: 34, trend: "stable", days: [] },
      vo2max: null,
      heartRate: null,
      findings: [],
      coverage: { days: 0, ready: false },
      context: [],
      updatedAt: "2026-08-19T20:00:00.000Z",
    });

    assert.equal(summary.daily_overview.recovery, 91);
    assert.equal(summary.daily_overview.stress, 34);
    assert.equal(summary.daily_overview.sleep_h, null);
    assert.equal(summary.daily_overview.vo2max, null);
    assert.equal(summary.sleep, null);
    assert.equal(summary.updated_at, "2026-08-19T20:00:00.000Z");
  });
});
