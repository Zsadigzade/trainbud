import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toolRegistry } from "../src/tools/index.js";
import {
  buildRecoveryStatus,
  normalizeWeights,
  scoreFromHrv,
  scoreFromSleep,
} from "../src/tools/recovery.js";
import {
  calculateTrend,
  filterActivitiesByRange,
  hashParams,
  parseActivityLocalDateTime,
  parseIsoDate,
  formatIsoDate,
  sanitizeErrorMessage,
} from "../src/utils/helpers.js";
import type { ActivitySummary } from "../src/garmin/types.js";
import { formatToolError } from "../src/toolErrors.js";
import { GarminApiError } from "../src/garmin/types.js";

describe("tool registry", () => {
  // The exhaustive list, which is what catches an accidental addition or
  // removal, lives in tests/contextTools.test.ts. A second copy here would
  // simply be a second thing to update.
  it("registers every Garmin data tool", () => {
    const names = toolRegistry.map((tool) => tool.name);

    for (const expected of [
      "get_latest_activity",
      "get_activities_range",
      "get_sleep_data",
      "get_heart_rate_trends",
      "get_recovery_status",
      "get_body_composition",
      "get_stress_levels",
      "get_vo2_max_trends",
      "get_training_insights",
    ]) {
      assert.ok(names.includes(expected), `${expected} is not registered`);
    }
  });
});

describe("helpers", () => {
  // The contract is not "what does toISOString say" -- that is an artefact of
  // which midnight the Date happens to sit on. It is "which calendar day will
  // garmin-connect ask Garmin about", and that is decided by its toDateString:
  //
  //     const offset = date.getTimezoneOffset();
  //     new Date(date.getTime() - offset * 60000).toISOString().split("T")[0]
  //
  // which round-trips a LOCAL-midnight Date and shifts a UTC-midnight one. The
  // old assertion passed on a UTC+4 machine and would have passed on a broken
  // one too; this fails anywhere the day is wrong.
  function dayGarminWouldFetch(date: Date): string {
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60_000).toISOString().split("T")[0] as string;
  }

  it("parses an ISO date to the day Garmin will actually be asked about", () => {
    assert.equal(dayGarminWouldFetch(parseIsoDate("2026-06-01")), "2026-06-01");
    assert.equal(formatIsoDate(parseIsoDate("2026-06-01")), "2026-06-01");
  });

  it("round-trips every day of a month, in whatever zone this machine is in", () => {
    for (let day = 1; day <= 28; day += 1) {
      const iso = `2026-06-${String(day).padStart(2, "0")}`;
      assert.equal(dayGarminWouldFetch(parseIsoDate(iso)), iso, `slipped on ${iso}`);
    }
  });

  it("detects improving resting heart rate trend", () => {
    const trend = calculateTrend([48, 47, 46, 52, 53, 54], true);
    assert.equal(trend, "improving");
  });

  it("rejects invalid ISO dates", () => {
    assert.throws(() => parseIsoDate("invalid"), /Invalid date/);
  });

  it("hashes params with stable key order", () => {
    assert.equal(hashParams({ b: 2, a: 1 }), hashParams({ a: 1, b: 2 }));
  });

  it("filters activities by ISO date range", () => {
    const activities: ActivitySummary[] = [
      {
        activityId: 1,
        name: "Morning Run",
        type: "running",
        startTimeLocal: "2026-06-05T08:00:00.000",
        distanceMeters: 5000,
        durationSeconds: 1800,
        averageHeartRate: 150,
        maxHeartRate: 170,
        elevationGainMeters: 10,
        calories: 300,
        averageSpeedMps: 2.7,
      },
      {
        activityId: 2,
        name: "Evening Ride",
        type: "cycling",
        startTimeLocal: "2026-06-20T18:00:00.000",
        distanceMeters: 20000,
        durationSeconds: 3600,
        averageHeartRate: 130,
        maxHeartRate: 160,
        elevationGainMeters: 100,
        calories: 500,
        averageSpeedMps: 5.5,
      },
    ];

    const filtered = filterActivitiesByRange(activities, "2026-06-01", "2026-06-10");
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.name, "Morning Run");
  });

  it("filters activities with Garmin local datetime format", () => {
    const activities: ActivitySummary[] = [
      {
        activityId: 3,
        name: "Prague Tennis",
        type: "tennis",
        startTimeLocal: "2026-06-25 18:36:20",
        distanceMeters: 3940,
        durationSeconds: 3600,
        averageHeartRate: 120,
        maxHeartRate: 150,
        elevationGainMeters: 0,
        calories: 400,
        averageSpeedMps: 1.1,
      },
    ];

    const filtered = filterActivitiesByRange(activities, "2026-05-27", "2026-06-26");
    assert.equal(filtered.length, 1);
    assert.equal(parseActivityLocalDateTime("2026-06-25 18:36:20").isValid, true);
  });

  it("sanitizes sensitive details from error messages", () => {
    const sanitized = sanitizeErrorMessage(
      "Failed for user@example.com at C:/Users/secret/.env with password123"
    );
    assert.match(sanitized, /\[email\]/);
    assert.match(sanitized, /\[path\]/);
    assert.doesNotMatch(sanitized, /user@example.com/);
  });
});

describe("recovery weights", () => {
  it("keeps its defaults when the caller passes no weights", () => {
    // getRecoveryStatus builds {hrv: input.hrv_weight, ...} from an input with
    // no weights in it, so every key is present and explicitly undefined --
    // and spreading that over the defaults overwrites them. The total then
    // became NaN, NaN <= 0 is false so the guard did not catch it, and the
    // score came out NaN. JSON.stringify writes NaN as null, so it reached the
    // cache, the tool output and the watch as "Recovery score: null/100" with
    // all four component scores sitting right underneath it.
    const weights = normalizeWeights({
      hrv: undefined,
      sleep: undefined,
      stress: undefined,
      restingHr: undefined,
    });

    for (const [name, value] of Object.entries(weights)) {
      assert.ok(Number.isFinite(value), `${name} weight is ${value}`);
    }

    const total = weights.hrv + weights.sleep + weights.stress + weights.restingHr;
    assert.ok(Math.abs(total - 1) < 1e-9, `weights sum to ${total}`);
  });

  it("produces a real score from real components", () => {
    const weights = normalizeWeights({
      hrv: undefined,
      sleep: undefined,
      stress: undefined,
      restingHr: undefined,
    });

    const status = buildRecoveryStatus(
      { hrvScore: 95, sleepScore: 94, stressScore: 95, restingHrScore: 75 },
      weights
    );

    assert.ok(Number.isFinite(status.score), `score is ${status.score}`);
    assert.ok(status.score > 60 && status.score <= 100, `score is ${status.score}`);
  });

  // An unworn night is not a bad night.
  //
  // scoreFromSleep was handed `sleep?.sleepTimeSeconds ?? 0`, so a night with no
  // record at all became zero seconds, fell through every band and scored 35 --
  // and 35 dragged an otherwise excellent day under the 60 that reads
  // "fatigued". The app told a well-rested user to take a rest day because their
  // watch had been on the charger.
  it("does not score a night that was never measured", () => {
    assert.equal(scoreFromSleep(null, 0), null);
    assert.equal(scoreFromSleep(null, 600), null, "a ten-minute reading is not a night");
    assert.equal(scoreFromSleep(null, 8 * 3600), 90);
    assert.equal(scoreFromSleep(88, 0), 88, "a real score still wins");
  });

  it("drops an unmeasured component instead of scoring it badly", () => {
    const weights = normalizeWeights({
      hrv: undefined,
      sleep: undefined,
      stress: undefined,
      restingHr: undefined,
    });

    const measured = buildRecoveryStatus(
      { hrvScore: 95, sleepScore: null, stressScore: 95, restingHrScore: 90 },
      weights
    );

    assert.ok(
      measured.score >= 90,
      `an unworn night dragged the score to ${measured.score}`
    );
    assert.notEqual(measured.status, "fatigued");

    // The old behaviour, for contrast: scoring the absence as 35.
    const asZero = buildRecoveryStatus(
      { hrvScore: 95, sleepScore: 35, stressScore: 95, restingHrScore: 90 },
      weights
    );
    assert.ok(
      asZero.score < measured.score,
      "the regression this test exists to catch is no longer distinguishable"
    );
  });

  it("still honours weights the caller does pass", () => {
    const weights = normalizeWeights({ hrv: 1, sleep: 1, stress: undefined, restingHr: undefined });
    assert.ok(weights.hrv > 0.2 && weights.hrv < 0.5);
  });

  it("ignores a weight that is not a usable number", () => {
    const weights = normalizeWeights({ hrv: Number.NaN, sleep: undefined, stress: undefined, restingHr: undefined });
    for (const value of Object.values(weights)) {
      assert.ok(Number.isFinite(value));
    }
  });
});

describe("recovery scoring", () => {
  it("builds a recovered status for strong component scores", () => {
    const weights = normalizeWeights();
    const result = buildRecoveryStatus(
      {
        hrvScore: 95,
        sleepScore: 90,
        stressScore: 85,
        restingHrScore: 90,
      },
      weights
    );

    assert.equal(result.status, "recovered");
    assert.ok(result.score >= 80);
  });

  it("scores sleep from duration when score is missing", () => {
    assert.equal(scoreFromSleep(null, 8 * 3600), 90);
    assert.equal(scoreFromHrv(50, null), 80);
  });
});

describe("tool errors", () => {
  it("formats rate limit errors with retry guidance", () => {
    const message = formatToolError(new GarminApiError("Rate limited", 429, 60));
    assert.match(message, /Retry in 60 seconds/);
  });
});
