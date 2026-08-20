import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchDailyStress, fetchMaxMetrics, mapDailyStress, mapMaxMetrics } from "../src/garmin/rawApi.js";
import type { GarminConnectInstance } from "../src/garmin/garminConnect.js";

describe("rawApi mappers", () => {
  it("maps daily stress payloads", () => {
    const date = new Date("2026-06-25T00:00:00.000Z");
    const mapped = mapDailyStress(date, {
      overallStressLevel: 32,
      maxStressLevel: 78,
      restStressLevel: 12,
      stressDuration: 3600,
    });

    assert.equal(mapped?.date, "2026-06-25");
    assert.equal(mapped?.averageStress, 32);
    assert.equal(mapped?.maxStress, 78);
  });

  // The shape above never came from Connect -- it was written from a guess, and
  // the guess is why a broken mapper looked tested. This is what
  // /wellness-service/wellness/dailyStress/<date> actually returns: the average
  // is avgStressLevel, and there is no overallStressLevel, restStressLevel or
  // stressDuration in the response at all.
  it("maps the payload Connect actually returns", () => {
    const date = new Date("2026-08-18T00:00:00.000Z");
    const mapped = mapDailyStress(date, {
      userProfilePK: 136705478,
      calendarDate: "2026-08-18",
      maxStressLevel: 97,
      avgStressLevel: 31,
      stressValuesArray: [],
    });

    assert.equal(mapped?.averageStress, 31, "average stress was read from a field Connect does not send");
    assert.equal(mapped?.maxStress, 97);
    assert.equal(mapped?.restStress, null);
    assert.equal(mapped?.stressDurationSeconds, null);
  });

  it("requests the date as a path segment, not a query parameter", async () => {
    // Connect answers 404 for the query-parameter form, so every stress call
    // failed and the watch showed no stress and no recovery score.
    let seenUrl = "";
    let seenOptions: unknown;
    const client = {
      get: async (url: string, options?: unknown) => {
        seenUrl = url;
        seenOptions = options;
        return {};
      },
    } as unknown as GarminConnectInstance;

    await fetchDailyStress(client, new Date("2026-08-18T00:00:00.000Z"));

    assert.equal(
      seenUrl,
      "https://connectapi.garmin.com/wellness-service/wellness/dailyStress/2026-08-18"
    );
    assert.equal(seenOptions, undefined, "a query parameter was still attached");
  });

  it("treats Connect's negative sentinels as missing", () => {
    // A day the watch was not worn comes back as -1 (or -2 while the day is
    // still partial). Carried through as a number it is averaged in with real
    // readings and drags the weekly stress average below anything measurable.
    const mapped = mapDailyStress(new Date("2026-08-18T00:00:00.000Z"), {
      avgStressLevel: -1,
      maxStressLevel: -1,
    });

    assert.equal(mapped?.averageStress, null);
    assert.equal(mapped?.maxStress, null);
  });

  it("asks for the latest VO2 max, not a specific day", async () => {
    // maxmet/daily/<date> is a 404. VO2 max is only recomputed after a
    // qualifying activity, so the daily form would be empty most days anyway.
    let seenUrl = "";
    const client = {
      get: async (url: string) => {
        seenUrl = url;
        return {};
      },
    } as unknown as GarminConnectInstance;

    await fetchMaxMetrics(client, new Date("2026-08-18T00:00:00.000Z"));

    assert.equal(
      seenUrl,
      "https://connectapi.garmin.com/metrics-service/metrics/maxmet/latest/2026-08-18"
    );
  });

  it("maps VO2 max payloads", () => {
    const date = new Date("2026-06-25T00:00:00.000Z");
    const mapped = mapMaxMetrics(date, {
      generic: { vo2MaxValue: 48 },
      cycling: { vo2MaxValue: 44 },
    });

    assert.equal(mapped?.date, "2026-06-25");
    assert.equal(mapped?.vo2Max, 48);
    assert.equal(mapped?.vo2MaxCycling, 44);
  });

  // maxmet/latest/<date> ignores the date it is given and answers with the
  // current reading. Captured from a real response on 2026-08-20: the request
  // was for 2026-04-05, months before the watch existed, and it came back with
  // a measurement calendar-dated 2026-08-12. Stamping that with the requested
  // date wrote one real reading across 150 days as if measured on each.
  it("dates a VO2 max reading by when it was measured, not when it was asked for", () => {
    const mapped = mapMaxMetrics(new Date("2026-04-05T00:00:00.000Z"), {
      generic: {
        calendarDate: "2026-08-12",
        vo2MaxPreciseValue: 45.9,
        vo2MaxValue: 46,
        fitnessAge: null,
        maxMetCategory: 0,
      },
      cycling: null,
    });

    assert.equal(mapped?.date, "2026-08-12");
    assert.equal(mapped?.vo2Max, 46);
  });

  it("falls back to the requested date when Connect omits its own", () => {
    const mapped = mapMaxMetrics(new Date("2026-06-25T00:00:00.000Z"), {
      generic: { vo2MaxValue: 46 },
    });

    assert.equal(mapped?.date, "2026-06-25");
  });

  it("returns null for empty stress payloads", () => {
    const mapped = mapDailyStress(new Date("2026-06-25T00:00:00.000Z"), null);
    assert.equal(mapped, null);
  });
});
