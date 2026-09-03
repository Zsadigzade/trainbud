import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendRawPayload,
  closeHistoryDb,
  historyStats,
  openHistoryDb,
  pruneRawPayloads,
  putActivities,
  putMetrics,
  rawPayloadRevisions,
  RAW_REVISIONS_KEPT,
} from "../src/history/store.js";
import type { ActivitySummary } from "../src/garmin/types.js";

const DAY = 86_400;
const NOW = 1_760_000_000;

describe("bounding the raw payload archive", () => {
  let directory: string;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-prune-"));
    openHistoryDb(path.join(directory, "history.db"));
  });

  after(() => {
    closeHistoryDb();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("keeps the newest revisions of a day and drops the rest", () => {
    for (let revision = 0; revision < 8; revision += 1) {
      appendRawPayload("2026-09-01", "sleep", { revision }, NOW - (8 - revision) * 60);
    }

    const pruned = pruneRawPayloads(NOW);

    assert.equal(pruned.supersededRevisions, 8 - RAW_REVISIONS_KEPT);
    const kept = rawPayloadRevisions("2026-09-01", "sleep");
    assert.equal(kept.length, RAW_REVISIONS_KEPT);
    assert.deepEqual(
      kept.map((row) => (JSON.parse(row.json) as { revision: number }).revision),
      [5, 6, 7],
      "the newest revisions survive, so a restatement is still visible"
    );
  });

  it("counts revisions per day and per source, not across the table", () => {
    appendRawPayload("2026-09-02", "sleep", { a: 1 }, NOW - 300);
    appendRawPayload("2026-09-02", "stress", { b: 1 }, NOW - 200);
    appendRawPayload("2026-09-03", "sleep", { c: 1 }, NOW - 100);

    pruneRawPayloads(NOW);

    assert.equal(rawPayloadRevisions("2026-09-02", "sleep").length, 1);
    assert.equal(rawPayloadRevisions("2026-09-02", "stress").length, 1);
    assert.equal(rawPayloadRevisions("2026-09-03", "sleep").length, 1);
  });

  it("drops payloads older than the retention window", () => {
    appendRawPayload("2020-01-01", "sleep", { old: true }, NOW - 400 * DAY);

    const pruned = pruneRawPayloads(NOW, 180);

    assert.equal(pruned.agedOut, 1);
    assert.equal(rawPayloadRevisions("2020-01-01", "sleep").length, 0);
  });

  it("never touches a measurement or an activity", () => {
    putMetrics("2026-09-01", [{ kind: "sleep_score", value: 82 }], NOW);
    const activity: ActivitySummary = {
      activityId: 99,
      name: "Morning Run",
      type: "running",
      startTimeLocal: "2026-09-01 07:30:00",
      distanceMeters: 5000,
      durationSeconds: 1800,
      averageHeartRate: 145,
      maxHeartRate: 170,
      elevationGainMeters: 30,
      calories: 400,
      averageSpeedMps: 2.8,
    };
    putActivities([activity], NOW);

    const before = historyStats();
    pruneRawPayloads(NOW);
    const after = historyStats();

    assert.equal(after.metricRows, before.metricRows);
    assert.equal(after.activityRows, before.activityRows);
  });

  it("is a no-op on a table already inside both limits", () => {
    const first = pruneRawPayloads(NOW);
    const second = pruneRawPayloads(NOW);

    assert.equal(second.agedOut, 0);
    assert.equal(second.supersededRevisions, 0);
    assert.ok(first.agedOut + first.supersededRevisions >= 0);
  });
});
