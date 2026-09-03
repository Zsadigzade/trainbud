import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeHistoryDb, historyStats, markIngested, openHistoryDb, putMetrics } from "../src/history/store.js";

// `trainbud status` on the live install:
//
//     History span: 2026-06-09 to 2026-08-21
//     Days Garmin had no data for: 1590
//
// 1590 days is four and a half years, out of a store covering 366 dates. The
// count was over `ingest_day` ROWS, and ingest_day is keyed (date, source)
// across six sources -- so it reported checkpoints and called them days, and
// the line exists precisely to reassure someone that a short span is Garmin's
// fault rather than a broken backfill. A number that cannot be a number of days
// does the opposite.
//
// A day Garmin had no data for is a date where NO source returned data and at
// least one said so. A date whose only checkpoints are errors is a day nobody
// managed to ask about, which is a different thing and must not be counted.

describe("days Garmin had no data for", () => {
  let directory: string;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-empty-"));
    openHistoryDb(path.join(directory, "history.db"));

    // Two days genuinely empty across every source -- the pre-purchase case
    // this line was written for.
    for (const date of ["2026-06-01", "2026-06-02"]) {
      for (const source of ["sleep", "heart_rate", "stress", "vo2max", "body_composition", "activities"] as const) {
        markIngested(date, source, "empty");
      }
    }

    // A day with a real measurement, and nothing recorded for the other five
    // sources. Six rows, five of them 'empty' -- and not an empty day.
    markIngested("2026-06-03", "sleep", "data");
    for (const source of ["heart_rate", "stress", "vo2max", "body_composition", "activities"] as const) {
      markIngested("2026-06-03", source, "empty");
    }
    putMetrics("2026-06-03", [{ kind: "sleep_seconds", value: 25_200 }]);

    // A day nobody managed to ask about. Not an answer from Garmin at all.
    markIngested("2026-06-04", "sleep", "error");
    markIngested("2026-06-04", "stress", "error");
  });

  after(() => {
    closeHistoryDb();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("counts days, not checkpoint rows", () => {
    const stats = historyStats();

    // 20 rows across 4 dates. The old count returned 17.
    assert.equal(stats.emptyDays, 2);
  });

  it("does not count a day that produced a measurement from any source", () => {
    const stats = historyStats();

    assert.ok(stats.emptyDays < 3, "2026-06-03 recorded sleep and is not an empty day");
  });

  it("does not count a day whose requests only failed", () => {
    // "Garmin had no data" and "nothing could be asked" are different facts,
    // and this project's bug history is mostly the second rendered as the first.
    const stats = historyStats();

    assert.equal(stats.emptyDays, 2, "2026-06-04 only has errors and is unknown, not empty");
  });

  it("can never exceed the number of dates in the store", () => {
    const stats = historyStats();

    assert.ok(
      stats.emptyDays <= 4,
      `${stats.emptyDays} empty days across 4 dates is not a possible number`
    );
  });
});
