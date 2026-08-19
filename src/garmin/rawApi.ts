import { DateTime } from "luxon";
import type { GarminConnectInstance } from "./garminConnect.js";

const GC_API = "https://connectapi.garmin.com";

function toGarminDate(date: Date): string {
  return DateTime.fromJSDate(date, { zone: "utc" }).toFormat("yyyy-MM-dd");
}

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
 * `maxmet/daily/<date>` answers 404 -- it is `latest/<date>`, which returns the
 * most recent measurement on or before that date. VO2 max is only recomputed
 * after a qualifying activity, so "latest" is the right question anyway: asking
 * for one specific day would come back empty on most days even if the daily
 * route existed. Every VO2 max reading was missing because of this.
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

  return {
    date: toGarminDate(date),
    vo2Max,
    vo2MaxCycling,
  };
}
