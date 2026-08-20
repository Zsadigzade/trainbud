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
  it("parses ISO dates", () => {
    const date = parseIsoDate("2026-06-01");
    assert.match(date.toISOString(), /2026-06-01/);
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
