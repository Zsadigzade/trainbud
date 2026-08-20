import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendRawPayload,
  closeHistoryDb,
  getActivitiesBetween,
  getIngestCheckpoint,
  getMetricSeries,
  historyStats,
  markIngested,
  openHistoryDb,
  putActivities,
  putMetrics,
  rawPayloadRevisions,
} from "../src/history/store.js";
import type { ActivitySummary } from "../src/garmin/types.js";

describe("history store", () => {
  let directory: string;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-history-"));
    openHistoryDb(path.join(directory, "history.db"));
  });

  after(() => {
    closeHistoryDb();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("round-trips a metric", () => {
    putMetrics("2026-08-19", [{ kind: "resting_hr", value: 52 }]);

    assert.deepEqual(getMetricSeries("resting_hr", "2026-08-01", "2026-08-31"), [
      { date: "2026-08-19", value: 52 },
    ]);
  });

  // Garmin restates data: a sleep score finalizes hours after waking, VO2 max is
  // recomputed after a qualifying activity. The normalized row is the current
  // truth, so it is overwritten rather than duplicated.
  it("upserts a metric rather than accumulating rows", () => {
    putMetrics("2026-08-18", [{ kind: "sleep_score", value: 71 }], 1000);
    putMetrics("2026-08-18", [{ kind: "sleep_score", value: 78 }], 2000);

    const series = getMetricSeries("sleep_score", "2026-08-18", "2026-08-18");
    assert.equal(series.length, 1);
    assert.equal(series[0]?.value, 78);
  });

  it("returns a series in ascending date order and clips to the range", () => {
    putMetrics("2026-07-01", [{ kind: "vo2max", value: 44 }]);
    putMetrics("2026-08-01", [{ kind: "vo2max", value: 45 }]);
    putMetrics("2026-08-19", [{ kind: "vo2max", value: 46 }]);

    assert.deepEqual(getMetricSeries("vo2max", "2026-08-01", "2026-08-19"), [
      { date: "2026-08-01", value: 45 },
      { date: "2026-08-19", value: 46 },
    ]);
  });

  it("writes several metrics for one date in a single call", () => {
    putMetrics("2026-08-17", [
      { kind: "stress_avg", value: 34 },
      { kind: "stress_max", value: 88 },
    ]);

    assert.equal(getMetricSeries("stress_avg", "2026-08-17", "2026-08-17").length, 1);
    assert.equal(getMetricSeries("stress_max", "2026-08-17", "2026-08-17").length, 1);
  });

  // The archive is append-only on purpose: keeping every fetch is what makes a
  // restatement visible instead of silently replacing what came before.
  it("keeps every raw payload revision", () => {
    appendRawPayload("2026-08-19", "sleep", { sleepScore: 71 }, 1000);
    appendRawPayload("2026-08-19", "sleep", { sleepScore: 78 }, 2000);

    const revisions = rawPayloadRevisions("2026-08-19", "sleep");
    assert.equal(revisions.length, 2);
    assert.equal(revisions[0]?.fetchedAt, 1000);
    assert.equal(JSON.parse(revisions[1]?.json ?? "{}").sleepScore, 78);
  });

  it("upserts the ingest checkpoint", () => {
    markIngested("2026-08-19", "stress", "empty", 1000);
    assert.equal(getIngestCheckpoint("2026-08-19", "stress")?.outcome, "empty");

    markIngested("2026-08-19", "stress", "data", 2000);
    const checkpoint = getIngestCheckpoint("2026-08-19", "stress");
    assert.equal(checkpoint?.outcome, "data");
    assert.equal(checkpoint?.fetchedAt, 2000);
  });

  it("reports no checkpoint for a date never fetched", () => {
    assert.equal(getIngestCheckpoint("2025-01-01", "sleep"), null);
  });

  it("keys activities on their Garmin id so re-ingesting does not duplicate", () => {
    const activity: ActivitySummary = {
      activityId: 991,
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
    };

    putActivities([activity]);
    putActivities([{ ...activity, name: "Morning Run (renamed)" }]);

    const stored = getActivitiesBetween("2026-08-19", "2026-08-19");
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.name, "Morning Run (renamed)");
    assert.equal(stored[0]?.date, "2026-08-19");
    assert.equal(stored[0]?.avgHr, 148);
  });

  it("keeps an activity with no distance", () => {
    putActivities([
      {
        activityId: 992,
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
    ]);

    const stored = getActivitiesBetween("2026-08-18", "2026-08-18");
    assert.equal(stored[0]?.distanceMeters, null);
    assert.equal(stored[0]?.durationSeconds, 2700);
  });

  it("reports the span the store covers", () => {
    const stats = historyStats();

    assert.ok(stats.metricRows > 0);
    assert.ok(stats.rawRows > 0);
    assert.equal(stats.activityRows, 2);
    assert.equal(stats.oldestDate, "2026-07-01");
    assert.equal(stats.newestDate, "2026-08-19");
    // The only day checkpointed empty above was then re-checkpointed as data,
    // which is the upsert working.
    assert.equal(stats.emptyDays, 0);
  });
});
