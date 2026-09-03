import { DateTime } from "luxon";
import type { GarminConnectInstance } from "./garminConnect.js";

const GC_API = "https://connectapi.garmin.com";

/**
 * The calendar day this Date stands for, read in the zone it was built in.
 *
 * Every Date reaching here is LOCAL midnight -- `getDateRange` and
 * `getDatesBetween` both go through `DateTime.local().startOf("day")`. Reading
 * one of those `{ zone: "utc" }` does not convert it, it asks which UTC day
 * that instant falls on, and for any zone east of UTC that is the day before.
 * On this machine, Asia/Baku at UTC+4, local midnight on 2026-09-03 is
 * 2026-09-02T20:00Z, so every stress and VO2 max request asked Connect about
 * 2026-09-02 and the answer was then stamped 2026-09-02 as well -- plausible
 * numbers filed under a day the user did not live, feeding the recovery score.
 * Auckland is off by one the same way; Los Angeles happens to land right,
 * which is the mirror image of the garmin-connect bug fixed in d64a78a.
 *
 * Asserting `toISOString()` is what let that one survive: it is a property of
 * which midnight the Date sits on, not of the day Garmin is asked about. The
 * test beside this one pins the day in the URL, in four zones.
 */
function toGarminDate(date: Date): string {
  return DateTime.fromJSDate(date).toFormat("yyyy-MM-dd");
}

/** Exported for the timezone test: the bug is invisible from outside this module. */
export const __toGarminDateForTest = toGarminDate;

/**
 * Connect takes the date as a path segment here. Sent as a query parameter --
 * which is how this was written -- it answers 404 for every day, so stress was
 * always empty and the recovery score, which is partly built from stress, was
 * always degraded. The failure was invisible because the 404s were swallowed
 * per day and the tool simply reported "no stress data".
 */
export async function fetchDailyStress(client: GarminConnectInstance, date: Date): Promise<unknown> {
  return client.get(`${GC_API}/wellness-service/wellness/dailyStress/${toGarminDate(date)}`);
}

/**
 * `maxmet/daily/<date>` answers 404 -- it is `latest/<date>`. VO2 max is only
 * recomputed after a qualifying activity, so "latest" is the right question
 * anyway: a daily route would come back empty on most days even if it existed.
 *
 * The catch is that this endpoint **ignores the date it is given**. Asked about
 * 2026-04-05 it returns the current measurement with its own
 * `generic.calendarDate` of 2026-08-12. Stamping the response with the
 * requested date -- which is what this did -- writes one real reading across
 * every day in the range as if it had been measured on each of them, which is
 * invented history, and a trend over it is flat by construction.
 */
export async function fetchMaxMetrics(client: GarminConnectInstance, date: Date): Promise<unknown> {
  return client.get(`${GC_API}/metrics-service/metrics/maxmet/latest/${toGarminDate(date)}`);
}

export interface DailyStressSummary {
  date: string;
  averageStress: number | null;
  maxStress: number | null;
  restStress: number | null;
  stressDurationSeconds: number | null;
}

export interface Vo2MaxEntry {
  date: string;
  vo2Max: number | null;
  vo2MaxCycling: number | null;
}

/**
 * Connect reports a negative stress level for a day it has no measurement for:
 * -1 when the watch was not worn, -2 while the day is still in progress. They
 * are sentinels, not readings, and averaging them in pulls the weekly figure
 * below anything the scale can produce.
 */
function measured(value: number | null): number | null {
  return value === null || value < 0 ? null : value;
}

export function mapDailyStress(date: Date, payload: unknown): DailyStressSummary | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const data = payload as Record<string, unknown>;

  // The real response carries avgStressLevel and maxStressLevel and nothing
  // else of use: there is no overallStressLevel, restStressLevel or
  // stressDuration in it. overallStressLevel is kept as a fallback because
  // other wellness endpoints do use that name.
  const averageStress =
    typeof data.avgStressLevel === "number"
      ? data.avgStressLevel
      : typeof data.overallStressLevel === "number"
        ? data.overallStressLevel
        : null;

  return {
    date: toGarminDate(date),
    averageStress: measured(averageStress),
    maxStress: measured(typeof data.maxStressLevel === "number" ? data.maxStressLevel : null),
    restStress: typeof data.restStressLevel === "number" ? data.restStressLevel : null,
    stressDurationSeconds:
      typeof data.stressDuration === "number" ? data.stressDuration : null,
  };
}

export function mapMaxMetrics(date: Date, payload: unknown): Vo2MaxEntry | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const data = payload as Record<string, unknown>;
  const generic = data.generic as Record<string, unknown> | undefined;
  const cycling = data.cycling as Record<string, unknown> | undefined;

  const vo2Max =
    typeof generic?.vo2MaxValue === "number"
      ? generic.vo2MaxValue
      : typeof data.vo2MaxValue === "number"
        ? data.vo2MaxValue
        : null;

  const vo2MaxCycling =
    typeof cycling?.vo2MaxValue === "number"
      ? cycling.vo2MaxValue
      : typeof data.vo2MaxCyclingValue === "number"
        ? data.vo2MaxCyclingValue
        : null;

  if (vo2Max === null && vo2MaxCycling === null) {
    return null;
  }

  // The day the measurement was actually taken, which is rarely the day asked
  // about. Falling back to the requested date only when Connect omits its own.
  const measuredOn =
    typeof generic?.calendarDate === "string" && generic.calendarDate.length > 0
      ? generic.calendarDate
      : toGarminDate(date);

  return {
    date: measuredOn,
    vo2Max,
    vo2MaxCycling,
  };
}
