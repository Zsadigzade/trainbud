import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DateTime } from "luxon";
import {
  fetchDaysOrStore,
  isPartialOrStored,
  storedActivitiesBetween,
  storedFetchNote,
} from "../src/history/fallback.js";
import { mapSleepData } from "../src/garmin/daily.js";
import {
  appendRawPayload,
  closeHistoryDb,
  openHistoryDb,
  putActivities,
  putMetrics,
} from "../src/history/store.js";
import type { SleepNightSummary } from "../src/garmin/types.js";
import type { DayFetchResult } from "../src/garmin/partial.js";

// The bug this exists for.
//
// Every per-metric tool read Garmin and nothing else. With the session expired
// and Cloudflare rate limiting sign-in -- the state this machine was in on
// 2026-09-03 -- `get_sleep_data` threw, `buildWatchSummary`'s six payload calls
// all returned null, and an MCP client was told the request had failed. Meanwhile
// history.db held 598 measurements and 2139 archived responses.
//
// So the model said it had no access to the user's data, and for the second
// time in one release it was telling the truth.
//
// The store is not a cache. It is TrainBud's own copy of the record, kept for
// exactly this, and until now nothing on the read path had ever opened it.

const ISO = (offset: number): string =>
  DateTime.local().startOf("day").minus({ days: offset }).toISODate() ?? "";

const DATE = (offset: number): Date =>
  DateTime.local().startOf("day").minus({ days: offset }).toJSDate();

/** The shape Connect actually returns, trimmed to what the mapper reads. */
function sleepResponse(hours: number, score: number): unknown {
  return {
    dailySleepDTO: {
      sleepTimeSeconds: Math.round(hours * 3600),
      deepSleepSeconds: 4800,
      lightSleepSeconds: 13080,
      remSleepSeconds: 4800,
      awakeCount: 2,
      avgSleepStress: 18,
      sleepScores: { overall: { value: score } },
    },
    avgOvernightHrv: 52,
    hrvStatus: "BALANCED",
  };
}

function liveResult(values: SleepNightSummary[], unreachable: number, requested: number): DayFetchResult<SleepNightSummary> {
  return { values, unreachableDays: unreachable, requestedDays: requested };
}

const options = (live: () => Promise<DayFetchResult<SleepNightSummary>>, days: number) => ({
  dates: Array.from({ length: days }, (_, offset) => DATE(offset + 1)),
  source: "sleep" as const,
  live,
  fromRaw: (date: Date, payload: unknown) =>
    mapSleepData(date, payload as Parameters<typeof mapSleepData>[1]),
  dateOf: (night: SleepNightSummary) => night.date,
});

describe("the store answers when Garmin will not", () => {
  let directory: string;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-fallback-"));
    openHistoryDb(path.join(directory, "history.db"));

    // Three archived nights, exactly as ingest wrote them.
    for (let offset = 1; offset <= 3; offset += 1) {
      appendRawPayload(ISO(offset), "sleep", sleepResponse(7 + offset * 0.1, 80 - offset));
    }
  });

  after(() => {
    closeHistoryDb();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("serves stored nights when the live call throws outright", async () => {
    const result = await fetchDaysOrStore(
      options(() => {
        throw new Error("Garmin is rate limiting sign-in. 47s left to wait.");
      }, 3)
    );

    assert.equal(result.values.length, 3);
    assert.equal(result.storedDays, 3);
    assert.equal(result.storedThrough, ISO(1));
    // Not a single day is left looking like an absence of data.
    assert.equal(result.unreachableDays, 0);
  });

  it("re-runs the real mapper, so a stored night is not a thinner night", async () => {
    const result = await fetchDaysOrStore(
      options(() => {
        throw new Error("no session");
      }, 3)
    );

    const night = result.values.find((value) => value.date === ISO(1));
    assert.ok(night);
    // The whole reason for reading raw_payload rather than daily_metric: the
    // stage breakdown, the sleep score and the overnight HRV all survive.
    assert.equal(night.deepSleepSeconds, 4800);
    assert.equal(night.remSleepSeconds, 4800);
    assert.equal(night.sleepScore, 79);
    assert.equal(night.avgOvernightHrv, 52);
  });

  it("fills only the days the live call could not reach", async () => {
    const liveNight = mapSleepData(DATE(1), sleepResponse(8, 91) as never);
    assert.ok(liveNight);

    const result = await fetchDaysOrStore(
      options(async () => liveResult([liveNight], 2, 3), 3)
    );

    assert.equal(result.storedDays, 2);
    // The live night wins for its own date; it is the fresher measurement.
    assert.equal(result.values.find((value) => value.date === ISO(1))?.sleepScore, 91);
    assert.equal(result.values.length, 3);
  });

  it("never opens the store when the live call answered completely", async () => {
    const nights = [1, 2, 3]
      .map((offset) => mapSleepData(DATE(offset), sleepResponse(7, 70) as never))
      .filter((night): night is SleepNightSummary => night !== null);

    const result = await fetchDaysOrStore(options(async () => liveResult(nights, 0, 3), 3));

    assert.equal(result.storedDays, 0);
    assert.equal(result.storedThrough, null);
  });

  it("returns days newest first, the order every renderer assumes", async () => {
    const result = await fetchDaysOrStore(
      options(() => {
        throw new Error("no session");
      }, 3)
    );

    assert.deepEqual(
      result.values.map((value) => value.date),
      [ISO(1), ISO(2), ISO(3)]
    );
  });

  it("says nothing was reachable when neither Garmin nor the store has the day", async () => {
    const result = await fetchDaysOrStore(
      options(() => {
        throw new Error("no session");
      }, 10)
    );

    assert.equal(result.storedDays, 3);
    assert.equal(result.unreachableDays, 7);
  });
});

// The second half of the same bug, and the half that actually bit.
//
// Every tool's window is anchored to today. On 2026-09-03 with the record
// ending 2026-08-21, `get_sleep_data` asked about 08-28..09-03 -- seven days
// the store has never held a row for -- so the fallback above found nothing and
// the tool reported "Could not reach Garmin for any of the last 7 nights",
// while seventy nights sat in the table. Serving the store is not enough if the
// window is pointed at the gap.
describe("the window moves to where the data is", () => {
  let directory: string;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-fallback-window-"));
    openHistoryDb(path.join(directory, "history.db"));

    // A record that stops a fortnight ago, exactly like the live install.
    for (let offset = 14; offset <= 18; offset += 1) {
      appendRawPayload(ISO(offset), "sleep", sleepResponse(7.5, 82));
    }
  });

  after(() => {
    closeHistoryDb();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("answers with the newest nights on record rather than with nothing", async () => {
    const result = await fetchDaysOrStore(
      options(() => {
        throw new Error("Garmin is rate limiting sign-in.");
      }, 3)
    );

    assert.equal(result.storedWindowMoved, true);
    assert.equal(result.values.length, 3);
    assert.deepEqual(
      result.values.map((value) => value.date),
      [ISO(14), ISO(15), ISO(16)]
    );
  });

  it("still counts every requested day as unanswered, because none of them was", async () => {
    const result = await fetchDaysOrStore(
      options(() => {
        throw new Error("no session");
      }, 3)
    );

    assert.equal(result.unreachableDays, 3);
  });

  it("does not move the window when the live call merely came back thin", async () => {
    // Garmin answered; it simply had nothing for those nights. That is a fact
    // about the user, and reaching into the archive to contradict it would be
    // the original bug wearing the opposite coat.
    const result = await fetchDaysOrStore(options(async () => liveResult([], 0, 3), 3));

    assert.equal(result.storedWindowMoved, false);
    assert.equal(result.values.length, 0);
  });

  it("shouts that these are not the days asked about", () => {
    const note = storedFetchNote(
      {
        values: [1, 2, 3],
        unreachableDays: 3,
        requestedDays: 3,
        storedDays: 3,
        storedThrough: "2026-08-21",
        storedWindowMoved: true,
      },
      "nights"
    );

    assert.match(note, /NOT THE LAST 3 NIGHTS/);
    assert.match(note, /2026-08-21/);
    // A model that read this as "the last three nights" would state a fortnight
    // -old figure as current, which is worse than the empty answer it replaces.
    assert.match(note, /most recent/);
  });
});

describe("a stored answer says so, in the text the model reads", () => {
  it("never renders a failed request as an absence of measurements", () => {
    const note = storedFetchNote(
      { values: [1, 2, 3], unreachableDays: 0, requestedDays: 3, storedDays: 3, storedThrough: "2026-08-21", storedWindowMoved: false },
      "nights"
    );

    assert.match(note, /stored/i);
    assert.match(note, /2026-08-21/);
    assert.doesNotMatch(note, /no sleep data/i);
  });

  it("distinguishes a partly stored answer from a wholly stored one", () => {
    const mixed = storedFetchNote(
      { values: [1, 2, 3], unreachableDays: 0, requestedDays: 3, storedDays: 1, storedThrough: "2026-08-21", storedWindowMoved: false },
      "nights"
    );

    assert.match(mixed, /1 of 3/);
  });

  it("falls back to the plain partial note when nothing came from the store", () => {
    const note = storedFetchNote(
      { values: [], unreachableDays: 3, requestedDays: 3, storedDays: 0, storedThrough: null, storedWindowMoved: false },
      "nights"
    );

    assert.match(note, /Could not reach Garmin/);
  });

  it("holds a stored answer in the cache for a minute, not for two hours", () => {
    assert.equal(
      isPartialOrStored({ unreachableDays: 0, storedDays: 2 }),
      true,
      "a stored answer must expire quickly so a working connection is picked up"
    );
    assert.equal(isPartialOrStored({ unreachableDays: 0, storedDays: 0 }), false);
  });
});

describe("activities come from the store too", () => {
  let directory: string;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-fallback-act-"));
    openHistoryDb(path.join(directory, "history.db"));

    putActivities([
      {
        activityId: 11,
        name: "Morning Run",
        type: "running",
        startTimeLocal: `${ISO(2)} 07:15:00`,
        distanceMeters: 10200,
        durationSeconds: 3300,
        averageHeartRate: 148,
        maxHeartRate: 171,
        elevationGainMeters: 88,
        calories: 640,
        averageSpeedMps: 3.09,
      },
    ]);
    putMetrics(ISO(2), [{ kind: "resting_hr", value: 48 }]);
  });

  after(() => {
    closeHistoryDb();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("rebuilds an activity summary from the stored row", () => {
    const activities = storedActivitiesBetween(ISO(30), ISO(0));

    assert.equal(activities.length, 1);
    assert.equal(activities[0]?.name, "Morning Run");
    assert.equal(activities[0]?.distanceMeters, 10200);
    assert.equal(activities[0]?.averageHeartRate, 148);
  });
});
