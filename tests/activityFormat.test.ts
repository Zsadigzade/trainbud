import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatActivitySummary } from "../src/tools/activities.js";
import {
  formatDistanceMeters,
  formatDuration,
  formatPaceMetersPerSecond,
} from "../src/utils/helpers.js";
import type { ActivitySummary } from "../src/garmin/types.js";

// Connect omits fields that do not apply to an activity — strength training has
// no distance or pace, an indoor ride no elevation. These were typed as plain
// numbers, so `get_activities_range` type-checked and then crashed on live data
// with "Cannot read properties of undefined (reading 'toFixed')".

const complete: ActivitySummary = {
  activityId: 1,
  name: "Morning Run",
  type: "running",
  startTimeLocal: "2026-08-16 07:30:00",
  distanceMeters: 5200,
  durationSeconds: 1920,
  averageHeartRate: 148,
  maxHeartRate: 171,
  elevationGainMeters: 42,
  calories: 380,
  averageSpeedMps: 2.7,
};

describe("activity formatting with missing fields", () => {
  it("formats a complete activity", () => {
    const text = formatActivitySummary(complete);
    assert.match(text, /Distance: 5\.20 km/);
    assert.match(text, /Elevation gain: 42 m/);
    assert.match(text, /Calories: 380/);
  });

  it("does not throw when elevation is missing", () => {
    const text = formatActivitySummary({ ...complete, elevationGainMeters: null });
    assert.match(text, /Elevation gain: n\/a/);
  });

  it("does not throw when an indoor activity reports no distance or pace", () => {
    const text = formatActivitySummary({
      ...complete,
      name: "Strength",
      type: "strength_training",
      distanceMeters: null,
      averageSpeedMps: null,
      elevationGainMeters: null,
    });
    assert.match(text, /Distance: n\/a/);
    assert.match(text, /Pace: n\/a/);
  });

  it("does not throw when every optional field is missing", () => {
    const text = formatActivitySummary({
      ...complete,
      distanceMeters: null,
      durationSeconds: null,
      averageHeartRate: null,
      maxHeartRate: null,
      elevationGainMeters: null,
      calories: null,
      averageSpeedMps: null,
    });
    assert.match(text, /Duration: n\/a/);
    assert.match(text, /Calories: n\/a/);
  });
});

describe("formatter null-safety", () => {
  it("formatDistanceMeters handles null and undefined", () => {
    assert.equal(formatDistanceMeters(null), "n/a");
    assert.equal(formatDistanceMeters(undefined), "n/a");
    assert.equal(formatDistanceMeters(900), "900 m");
    assert.equal(formatDistanceMeters(1500), "1.50 km");
  });

  it("formatDuration handles null and undefined", () => {
    assert.equal(formatDuration(null), "n/a");
    assert.equal(formatDuration(undefined), "n/a");
    assert.equal(formatDuration(90), "1m 30s");
  });

  it("formatPaceMetersPerSecond handles null, undefined and zero", () => {
    assert.equal(formatPaceMetersPerSecond(null), "n/a");
    assert.equal(formatPaceMetersPerSecond(undefined), "n/a");
    assert.equal(formatPaceMetersPerSecond(0), "n/a");
    assert.equal(formatPaceMetersPerSecond(2.5), "6:40 /km");
  });

  it("rejects NaN rather than rendering it", () => {
    assert.equal(formatDistanceMeters(Number.NaN), "n/a");
    assert.equal(formatDuration(Number.NaN), "n/a");
    assert.equal(formatPaceMetersPerSecond(Number.NaN), "n/a");
  });
});
