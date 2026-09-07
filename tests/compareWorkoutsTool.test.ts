import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeHistoryDb, openHistoryDb, putActivities } from "../src/history/store.js";
import { compareWorkoutsTool } from "../src/tools/compare.js";
import type { ActivitySummary } from "../src/garmin/types.js";

/**
 * `tests/compareWorkouts.test.ts` exercises the arithmetic in
 * `detect/compare.ts` and nothing else, which left the tool wrapper — the part
 * an MCP client actually calls — at 14% function coverage. The choices that
 * live only in the wrapper are the ones a user meets first: which workout is
 * the subject when nobody named one, what happens when the store is empty or
 * the id is wrong, and the earlier-of-same-type context that decides whether
 * the answer says "your first" or "nothing close enough".
 *
 * The gap was found by the hourly cloud routine, which could not push its own
 * fix; these are written here from the same finding.
 */
function activity(overrides: Partial<ActivitySummary> & { activityId: number }): ActivitySummary {
  return {
    name: "Run",
    type: "running",
    startTimeLocal: "2026-09-01 07:00:00",
    distanceMeters: 5000,
    durationSeconds: 1500,
    averageHeartRate: 150,
    maxHeartRate: 170,
    elevationGainMeters: 20,
    calories: 400,
    averageSpeedMps: 3.33,
    ...overrides,
  };
}

describe("the compare_workouts tool, not just its arithmetic", () => {
  let directory: string;
  let index = 0;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-compare-tool-"));
  });

  // A fresh store per case. Sharing one leaks activities between them, and the
  // counts these assert are exactly what leakage changes.
  beforeEach(() => {
    closeHistoryDb();
    index += 1;
    openHistoryDb(path.join(directory, `history-${index}.db`));
  });

  after(() => {
    closeHistoryDb();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("says the store is empty rather than failing, and names the fix", async () => {
    const result = await compareWorkoutsTool({});

    assert.equal(result.data.subject, null);
    assert.equal(result.data.comparableCount, 0);
    assert.match(result.text, /backfill/);
  });

  it("names the id when asked for an activity the store does not have", async () => {
    putActivities([activity({ activityId: 1, startTimeLocal: "2026-09-01 07:00:00" })]);

    const result = await compareWorkoutsTool({ activity_id: 99999 });

    assert.equal(result.data.subject, null);
    assert.match(result.text, /99999/);
    assert.match(result.text, /backfill/);
  });

  it("defaults to the most recent activity, by time and not by insertion order", async () => {
    putActivities([
      activity({ activityId: 10, startTimeLocal: "2026-09-05 06:00:00", distanceMeters: 5000 }),
      activity({ activityId: 11, startTimeLocal: "2026-09-03 06:00:00", distanceMeters: 5000 }),
    ]);

    const result = await compareWorkoutsTool({});

    assert.equal(result.data.subject?.activityId, 10, "the newest workout is the subject");
  });

  it("compares against an earlier effort of a similar distance", async () => {
    putActivities([
      activity({ activityId: 20, startTimeLocal: "2026-09-06 06:00:00", distanceMeters: 5000, durationSeconds: 1500 }),
      activity({ activityId: 21, startTimeLocal: "2026-09-07 06:00:00", distanceMeters: 5050, durationSeconds: 1600 }),
    ]);

    const result = await compareWorkoutsTool({ activity_id: 21 });

    assert.equal(result.data.closest?.activityId, 20);
    assert.equal(result.data.comparableCount, 1);
    assert.match(result.text, /compared with/);
  });

  it("counts the earlier workouts it could not use, so the answer is not 'your first'", async () => {
    // A 400 m effort with a 5 km run behind it: same sport, nowhere near the
    // same distance. The wrapper is what knows the difference.
    putActivities([
      activity({ activityId: 29, startTimeLocal: "2026-09-01 06:00:00", distanceMeters: 5000, durationSeconds: 1500 }),
      activity({ activityId: 30, startTimeLocal: "2026-09-08 06:00:00", distanceMeters: 400, durationSeconds: 120 }),
    ]);

    const result = await compareWorkoutsTool({ activity_id: 30 });

    assert.equal(result.data.comparableCount, 0);
    assert.ok(result.data.earlierSameType > 0, "earlier runs exist and must be counted");
    assert.ok(result.data.nearest, "the nearest earlier run is carried through");
    assert.doesNotMatch(result.text, /first/i);
    assert.match(result.text, /nothing close enough/i);
  });

  it("honours a limit on how many comparable workouts are considered", async () => {
    putActivities([
      activity({ activityId: 40, startTimeLocal: "2026-08-01 06:00:00", distanceMeters: 10000, durationSeconds: 3000 }),
      activity({ activityId: 41, startTimeLocal: "2026-08-02 06:00:00", distanceMeters: 10100, durationSeconds: 3010 }),
      activity({ activityId: 42, startTimeLocal: "2026-08-03 06:00:00", distanceMeters: 10200, durationSeconds: 3020 }),
      activity({ activityId: 43, startTimeLocal: "2026-08-04 06:00:00", distanceMeters: 10050, durationSeconds: 3030 }),
    ]);

    const all = await compareWorkoutsTool({ activity_id: 43 });
    const capped = await compareWorkoutsTool({ activity_id: 43, limit: 1 });

    assert.equal(all.data.comparableCount, 3);
    assert.equal(capped.data.comparableCount, 1);
  });
});
