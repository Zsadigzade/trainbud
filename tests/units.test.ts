import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatDistanceMeters,
  formatPaceMetersPerSecond,
} from "../src/utils/helpers.js";

// The units setting shipped before the conversion did: the profile accepted
// "imperial", the AI's system prompt told the model to answer in miles, and
// every number it was handed was still in kilometres. A setting that claims to
// change the units and does not is worse than no setting -- the reader has no
// way to tell which one they are looking at.

describe("distance in the user's own units", () => {
  it("defaults to metric", () => {
    assert.equal(formatDistanceMeters(5000), "5.00 km");
  });

  it("converts to miles", () => {
    assert.equal(formatDistanceMeters(1609.344, "imperial"), "1.00 mi");
    assert.equal(formatDistanceMeters(5000, "imperial"), "3.11 mi");
  });

  it("drops to the small unit below a quarter mile, as a runner would", () => {
    assert.match(formatDistanceMeters(100, "imperial"), /ft$/);
    assert.match(formatDistanceMeters(100), /m$/);
  });

  it("still reports an absent distance as absent in either system", () => {
    assert.equal(formatDistanceMeters(null, "imperial"), "n/a");
    assert.equal(formatDistanceMeters(undefined), "n/a");
  });
});

describe("pace in the user's own units", () => {
  it("defaults to minutes per kilometre", () => {
    // 200 m/min = 3.333 m/s -> 5:00 /km
    assert.equal(formatPaceMetersPerSecond(1000 / 300), "5:00 /km");
  });

  it("converts to minutes per mile", () => {
    assert.equal(formatPaceMetersPerSecond(1609.344 / 480, "imperial"), "8:00 /mi");
  });

  it("carries the rounded second into the minute instead of printing :60", () => {
    // Rounding 59.7 seconds gives 60, and "4:60 /km" is not a pace. Without
    // the carry this is wrong once in every sixty paces.
    const speed = 1000 / 299.7;
    assert.equal(formatPaceMetersPerSecond(speed), "5:00 /km");
  });

  it("refuses to invent a pace from a standstill", () => {
    assert.equal(formatPaceMetersPerSecond(0), "n/a");
    assert.equal(formatPaceMetersPerSecond(null, "imperial"), "n/a");
  });
});

// --- night labelling -------------------------------------------------------
//
// Kept in this file because it is the same class of defect as the units one: a
// label that asserts something about the data which the data does not support.

import { DateTime } from "luxon";
import { __nightLabelForTests } from "../src/dashboardData.js";

describe("what to call the most recent night", () => {
  const today = DateTime.fromISO("2026-09-04T02:00:00") as DateTime<true>;

  it("calls yesterday's night last night", () => {
    assert.equal(__nightLabelForTests("2026-09-03", today), "Last night");
  });

  it("refuses to call the night before last 'last night'", () => {
    // Read at two in the morning, the newest recorded night is the night
    // BEFORE last. Calling it "Last night" is the same fault as the sleep card
    // calling a fortnight-old night last night, which was fixed once already.
    assert.equal(__nightLabelForTests("2026-09-02", today), "Night of 2 Sep");
  });

  it("falls back to the generic label when there is no night at all", () => {
    assert.equal(__nightLabelForTests(null, today), "Last night");
  });
});
