import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DateTime } from "luxon";
import { pendingWork, runIngest } from "../src/history/ingest.js";
import {
  closeHistoryDb,
  getActivitiesBetween,
  getIngestCheckpoint,
  getMetricSeries,
  markIngested,
  openHistoryDb,
  rawPayloadRevisions,
} from "../src/history/store.js";
import type { GarminConnectInstance } from "../src/garmin/garminConnect.js";

const NOW = DateTime.fromISO("2026-08-19T12:00:00", { zone: "utc" });

let directory: string;
let dbIndex = 0;

function freshDb(): void {
  closeHistoryDb();
  directory ??= fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-ingest-"));
  dbIndex += 1;
  openHistoryDb(path.join(directory, `ingest-${dbIndex}.db`));
}

interface FakeCounts {
  sleep: number;
  heartRate: number;
  weight: number;
  get: number;
}

function fakeClient(
  counts: FakeCounts,
  overrides: { failSleep?: boolean; stressLevel?: number } = {}
): GarminConnectInstance {
  return {
    getSleepData: async () => {
      counts.sleep += 1;
      if (overrides.failSleep) {
        throw new Error("Connect said no");
      }
      return {
        avgOvernightHrv: 44,
        hrvStatus: "BALANCED",
        dailySleepDTO: {
          sleepTimeSeconds: 22680,
          deepSleepSeconds: 4800,
          lightSleepSeconds: 13080,
          remSleepSeconds: 4800,
          awakeCount: 2,
          avgSleepStress: 21,
          sleepScores: { overall: { value: 78 } },
        },
      };
    },
    getHeartRate: async () => {
      counts.heartRate += 1;
      return { restingHeartRate: 52, maxHeartRate: 171, heartRateValues: [] };
    },
    getDailyWeightData: async () => {
      counts.weight += 1;
      return { dateWeightList: [] };
    },
    get: async (url: string) => {
      counts.get += 1;
      if (url.includes("dailyStress")) {
        // -1 is what Connect reports for a day the watch was not worn, and
        // it reports it for every field, not just the average.
        const level = overrides.stressLevel ?? 34;
        return { avgStressLevel: level, maxStressLevel: level < 0 ? level : 88 };
      }
      return { generic: { vo2MaxValue: 46 } };
    },
  } as unknown as GarminConnectInstance;
}

function newCounts(): FakeCounts {
  return { sleep: 0, heartRate: 0, weight: 0, get: 0 };
}

describe("ingest planning", () => {
  beforeEach(() => {
    freshDb();
  });

  after(() => {
    closeHistoryDb();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("plans every day of every source on an empty store", () => {
    const work = pendingWork({ days: 3, sources: ["sleep", "stress"], now: NOW });

    assert.equal(work.length, 6);
  });

  // A backfill that is killed halfway should leave the most recent history
  // behind, not the oldest.
  it("plans the newest date first", () => {
    const work = pendingWork({ days: 3, sources: ["sleep"], now: NOW });

    assert.deepEqual(
      work.map((item) => item.date),
      ["2026-08-19", "2026-08-18", "2026-08-17"]
    );
  });

  // Otherwise every run re-fetches the same year of days the watch was not worn.
  it("never revisits an old day that came back empty", () => {
    markIngested("2026-06-01", "sleep", "empty", 1);
    const work = pendingWork({ days: 120, sources: ["sleep"], now: NOW });

    assert.ok(!work.some((item) => item.date === "2026-06-01"));
  });

  it("retries an old day that errored", () => {
    markIngested("2026-06-01", "sleep", "error", 1);
    const work = pendingWork({ days: 120, sources: ["sleep"], now: NOW });

    assert.ok(work.some((item) => item.date === "2026-06-01"));
  });

  // A sleep score finalizes hours after waking and Connect reports -2 for a day
  // still in progress, so a recent day is never a final answer.
  it("re-fetches the last three days even when they are already checkpointed", () => {
    const stale = NOW.toUnixInteger() - 7200;
    for (const date of ["2026-08-19", "2026-08-18", "2026-08-17", "2026-08-16"]) {
      markIngested(date, "sleep", "data", stale);
    }

    const work = pendingWork({ days: 10, sources: ["sleep"], now: NOW });

    assert.deepEqual(
      work.map((item) => item.date),
      ["2026-08-19", "2026-08-18", "2026-08-17", "2026-08-15", "2026-08-14", "2026-08-13", "2026-08-12", "2026-08-11", "2026-08-10"]
    );
  });

  it("leaves a recent day alone when it was checkpointed moments ago", () => {
    markIngested("2026-08-19", "sleep", "data", NOW.toUnixInteger() - 60);
    const work = pendingWork({ days: 1, sources: ["sleep"], now: NOW });

    assert.equal(work.length, 0);
  });
});

describe("ingest execution", () => {
  beforeEach(() => {
    freshDb();
  });

  it("writes both metric rows and the raw archive", async () => {
    const counts = newCounts();
    const result = await runIngest(fakeClient(counts), {
      days: 2,
      delayMs: 0,
      sources: ["sleep", "stress"],
      now: NOW,
    });

    assert.equal(result.fetched, 4);
    assert.equal(result.errors, 0);
    assert.equal(counts.sleep, 2);

    assert.deepEqual(getMetricSeries("sleep_score", "2026-08-18", "2026-08-19"), [
      { date: "2026-08-18", value: 78 },
      { date: "2026-08-19", value: 78 },
    ]);
    assert.equal(getMetricSeries("hrv_overnight", "2026-08-19", "2026-08-19")[0]?.value, 44);
    assert.equal(getMetricSeries("stress_avg", "2026-08-19", "2026-08-19")[0]?.value, 34);
    assert.equal(rawPayloadRevisions("2026-08-19", "sleep").length, 1);
  });

  it("does no work the second time except inside the stale window", async () => {
    const first = newCounts();
    await runIngest(fakeClient(first), { days: 10, delayMs: 0, sources: ["sleep"], now: NOW });
    assert.equal(first.sleep, 10);

    const second = newCounts();
    const result = await runIngest(fakeClient(second), {
      days: 10,
      delayMs: 0,
      sources: ["sleep"],
      now: NOW.plus({ hours: 2 }),
    });

    assert.equal(second.sleep, 3);
    assert.equal(result.fetched, 3);
  });

  // Connect reports -1 for a day the watch was not worn. Averaging that in
  // pulls a weekly figure below anything the scale can produce.
  it("records a sentinel day as ingested but stores no measurement", async () => {
    const counts = newCounts();
    await runIngest(fakeClient(counts, { stressLevel: -1 }), {
      days: 1,
      delayMs: 0,
      sources: ["stress"],
      now: NOW,
    });

    assert.equal(getMetricSeries("stress_avg", "2026-08-19", "2026-08-19").length, 0);
    assert.equal(getIngestCheckpoint("2026-08-19", "stress")?.outcome, "empty");
  });

  it("keeps going when one day fails and records the failure", async () => {
    const counts = newCounts();
    const result = await runIngest(fakeClient(counts, { failSleep: true }), {
      days: 3,
      delayMs: 0,
      sources: ["sleep"],
      now: NOW,
    });

    assert.equal(counts.sleep, 3);
    assert.equal(result.errors, 3);
    assert.equal(getIngestCheckpoint("2026-08-19", "sleep")?.outcome, "error");
  });

  it("makes no request at all when the signal is already aborted", async () => {
    const counts = newCounts();
    const controller = new AbortController();
    controller.abort();

    const result = await runIngest(fakeClient(counts), {
      days: 5,
      delayMs: 0,
      sources: ["sleep"],
      now: NOW,
      signal: controller.signal,
    });

    assert.equal(counts.sleep, 0);
    assert.equal(result.fetched, 0);
  });

  it("reports progress for every date it touches", async () => {
    const seen: string[] = [];
    await runIngest(newCountsClient(), {
      days: 2,
      delayMs: 0,
      sources: ["heart_rate"],
      now: NOW,
      onProgress: (progress) => seen.push(`${progress.source}:${progress.date}:${progress.outcome}`),
    });

    assert.deepEqual(seen, ["heart_rate:2026-08-19:data", "heart_rate:2026-08-18:data"]);
  });

  function newCountsClient(): GarminConnectInstance {
    return fakeClient(newCounts());
  }

  after(() => {
    closeHistoryDb();
  });
});

// The watch has a purchase date. Walking newest-first, a long unbroken run of
// empty days means the device did not exist yet, and every older request is
// spent against an account for nothing.
describe("early stop past the start of the record", () => {
  beforeEach(() => {
    freshDb();
  });

  after(() => {
    closeHistoryDb();
  });

  function emptyClient(counts: FakeCounts, dataUntilOffset: number): GarminConnectInstance {
    return {
      getSleepData: async (date?: Date) => {
        counts.sleep += 1;
        const offset = Math.round(
          (NOW.startOf("day").toMillis() - (date?.getTime() ?? 0)) / 86_400_000
        );
        if (offset > dataUntilOffset) {
          return { avgOvernightHrv: null };
        }
        return {
          avgOvernightHrv: 44,
          dailySleepDTO: {
            sleepTimeSeconds: 22680,
            deepSleepSeconds: 4800,
            lightSleepSeconds: 13080,
            remSleepSeconds: 4800,
            awakeCount: 2,
          },
        };
      },
    } as unknown as GarminConnectInstance;
  }

  it("stops a source after a long unbroken run of empty days", async () => {
    const counts = newCounts();
    const result = await runIngest(emptyClient(counts, 4), {
      days: 200,
      delayMs: 0,
      sources: ["sleep"],
      now: NOW,
      stopAfterEmptyDays: 10,
    });

    // 5 days of data, then 10 empties, then it gives up.
    assert.equal(counts.sleep, 15);
    assert.ok(result.skipped > 0);
  });

  // Skipping is not the same claim as "we asked and there was nothing", so the
  // abandoned days keep no checkpoint and a later run can still reach them.
  it("leaves the abandoned days uncheckpointed", async () => {
    await runIngest(emptyClient(newCounts(), 4), {
      days: 200,
      delayMs: 0,
      sources: ["sleep"],
      now: NOW,
      stopAfterEmptyDays: 10,
    });

    const oldDate = NOW.startOf("day").minus({ days: 150 }).toISODate() ?? "";
    assert.equal(getIngestCheckpoint(oldDate, "sleep"), null);
  });

  it("keeps going when the empty run is broken by real data", async () => {
    const counts = newCounts();
    await runIngest(emptyClient(counts, 400), {
      days: 30,
      delayMs: 0,
      sources: ["sleep"],
      now: NOW,
      stopAfterEmptyDays: 10,
    });

    assert.equal(counts.sleep, 30);
  });

  it("does not stop at all when the limit is zero", async () => {
    const counts = newCounts();
    await runIngest(emptyClient(counts, 2), {
      days: 40,
      delayMs: 0,
      sources: ["sleep"],
      now: NOW,
      stopAfterEmptyDays: 0,
    });

    assert.equal(counts.sleep, 40);
  });
});

// Activities are paged, not fetched per date, so they need their own path.
// Without it getActivitiesBetween is always empty and the load-ratio detector
// can never fire, which is how this shipped unnoticed the first time.
describe("activity ingest", () => {
  beforeEach(() => {
    freshDb();
  });

  after(() => {
    closeHistoryDb();
  });

  function pagingClient(pages: number[][], calls: Array<[number, number]>): GarminConnectInstance {
    return {
      getActivities: async (start = 0, limit = 100) => {
        calls.push([start, limit]);
        const page = pages[Math.floor(start / limit)] ?? [];
        return page.map((offset, index) => ({
          activityId: start + index + 1,
          activityName: "Run",
          startTimeLocal:
            (NOW.startOf("day").minus({ days: offset }).toISODate() ?? "") + " 07:30:00",
          distance: 8000,
          duration: 2700,
          averageHR: 145,
          maxHR: 165,
          elevationGain: 20,
          calories: 400,
          averageSpeed: 3,
          activityType: { typeKey: "running" },
        }));
      },
    } as unknown as GarminConnectInstance;
  }

  it("stores the activities it pages through", async () => {
    const calls: Array<[number, number]> = [];
    await runIngest(pagingClient([[0, 1, 2]], calls), {
      days: 30,
      delayMs: 0,
      sources: ["activities"],
      now: NOW,
    });

    const stored = getActivitiesBetween(
      NOW.startOf("day").minus({ days: 30 }).toISODate() ?? "",
      NOW.startOf("day").toISODate() ?? ""
    );
    assert.equal(stored.length, 3);
    assert.equal(stored[0]?.avgHr, 145);
  });

  // The pool is ordered newest first, so the first activity older than the
  // window means every remaining page is older still.
  it("stops paging once it passes the start of the window", async () => {
    const calls: Array<[number, number]> = [];
    await runIngest(pagingClient([[1, 2, 200], [400, 500]], calls), {
      days: 30,
      delayMs: 0,
      sources: ["activities"],
      now: NOW,
    });

    assert.equal(calls.length, 1, "should not have asked for a second page");
  });

  // A page shorter than the page size is already the end of the list.
  it("does not ask for another page after a short one", async () => {
    const calls: Array<[number, number]> = [];
    await runIngest(pagingClient([[1, 2], [3]], calls), {
      days: 30,
      delayMs: 0,
      sources: ["activities"],
      now: NOW,
    });

    assert.equal(calls.length, 1);
  });

  it("stops on an empty page after a full one", async () => {
    const calls: Array<[number, number]> = [];
    const fullPage = Array.from({ length: 100 }, () => 1);

    await runIngest(pagingClient([fullPage, []], calls), {
      days: 30,
      delayMs: 0,
      sources: ["activities"],
      now: NOW,
    });

    assert.equal(calls.length, 2);
  });

  it("counts as one unit of work rather than one per day", async () => {
    const calls: Array<[number, number]> = [];
    const result = await runIngest(pagingClient([[1, 2]], calls), {
      days: 365,
      delayMs: 0,
      sources: ["activities"],
      now: NOW,
    });

    assert.equal(result.fetched, 1);
  });
});

// The VO2 max endpoint ignores the date it is asked about and answers with the
// current reading. Recording that under the requested date wrote one real
// measurement across every day in the range as invented history.
describe("VO2 max lands on the day it was measured", () => {
  beforeEach(() => {
    freshDb();
  });

  after(() => {
    closeHistoryDb();
  });

  function latestOnlyClient(): GarminConnectInstance {
    return {
      get: async (url: string) => {
        if (url.includes("maxmet")) {
          return { generic: { calendarDate: "2026-08-12", vo2MaxValue: 46 } };
        }
        return {};
      },
    } as unknown as GarminConnectInstance;
  }

  it("writes one row on the measured date, not one per day asked about", async () => {
    await runIngest(latestOnlyClient(), {
      days: 30,
      delayMs: 0,
      sources: ["vo2max"],
      now: NOW,
      stopAfterEmptyDays: 0,
    });

    const rows = getMetricSeries("vo2max", "2026-01-01", "2026-12-31");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.date, "2026-08-12");
    assert.equal(rows[0]?.value, 46);
  });

  // Otherwise every pre-purchase day answers "data" forever and the empty-run
  // stop can never trip on this source.
  it("marks a day whose reading belongs elsewhere as empty", async () => {
    await runIngest(latestOnlyClient(), {
      days: 5,
      delayMs: 0,
      sources: ["vo2max"],
      now: NOW,
      stopAfterEmptyDays: 0,
    });

    assert.equal(getIngestCheckpoint("2026-08-19", "vo2max")?.outcome, "empty");
    assert.equal(getIngestCheckpoint("2026-08-17", "vo2max")?.outcome, "empty");
  });
});
