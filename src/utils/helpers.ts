import { DateTime } from "luxon";
import type { ActivitySummary } from "../garmin/types.js";

export type TrendDirection = "improving" | "declining" | "stable" | "insufficient_data";

// SECTION: Calendar days
//
// Every Date in this file is LOCAL midnight for the day it names, not UTC
// midnight.
//
// That is not a style choice. garmin-connect turns a Date into the day it asks
// Garmin about with `toDateString`, which subtracts getTimezoneOffset() and
// then reads the UTC date -- a function that round-trips a LOCAL-midnight Date
// and shifts a UTC-midnight one. Feeding it UTC midnight therefore asked for the
// wrong calendar day everywhere west of UTC: at UTC-5, `new Date("2026-08-19")`
// is 2026-08-18T19:00 local, and the library asked Garmin for the 18th while
// this code stored the answer under the 19th. Every daily metric -- sleep,
// heart rate, stress, weight -- was off by one day for those users, silently,
// with plausible numbers under the wrong dates.
//
// It never showed up here because the machine this was written on is UTC+4,
// where the shift lands inside the same day.
//
// A calendar day is a local question anyway: "how did I sleep on Tuesday" means
// the user's Tuesday.

export function parseIsoDate(value: string): Date {
  const parsed = DateTime.fromISO(value);
  if (!parsed.isValid) {
    throw new Error(`Invalid date "${value}". Use ISO 8601 format such as 2026-06-01.`);
  }
  return parsed.toJSDate();
}

export function formatIsoDate(date: Date): string {
  return DateTime.fromJSDate(date).toISODate() ?? "";
}

export function getDateRange(days: number): Date[] {
  const dates: Date[] = [];
  const today = DateTime.local().startOf("day");

  for (let offset = 0; offset < days; offset += 1) {
    dates.push(today.minus({ days: offset }).toJSDate());
  }

  return dates;
}

export function getYesterday(): Date {
  return DateTime.local().minus({ days: 1 }).startOf("day").toJSDate();
}

export function getDatesBetween(startDate: string, endDate: string): Date[] {
  const start = DateTime.fromISO(startDate).startOf("day");
  const end = DateTime.fromISO(endDate).startOf("day");

  if (!start.isValid || !end.isValid) {
    throw new Error("Invalid date range. Use ISO 8601 dates such as 2026-06-01.");
  }

  if (end < start) {
    throw new Error("end_date must be on or after start_date.");
  }

  const dates: Date[] = [];
  let cursor = start;

  while (cursor <= end) {
    dates.push(cursor.toJSDate());
    cursor = cursor.plus({ days: 1 });
  }

  return dates;
}

export function parseActivityLocalDateTime(value: string): DateTime {
  const fromIso = DateTime.fromISO(value, { setZone: true });
  if (fromIso.isValid) {
    return fromIso;
  }

  const fromSql = DateTime.fromSQL(value, { setZone: true });
  if (fromSql.isValid) {
    return fromSql;
  }

  return DateTime.invalid("unparsable");
}

export function filterActivitiesByRange(
  activities: ActivitySummary[],
  startDate: string,
  endDate: string
): ActivitySummary[] {
  const start = DateTime.fromISO(startDate).startOf("day");
  const end = DateTime.fromISO(endDate).startOf("day");

  return activities.filter((activity) => {
    const activityDay = parseActivityLocalDateTime(activity.startTimeLocal).startOf("day");
    if (!activityDay.isValid) {
      return false;
    }

    return activityDay.toMillis() >= start.toMillis() && activityDay.toMillis() <= end.toMillis();
  });
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return "n/a";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${remainingSeconds}s`;
}

const METRES_PER_MILE = 1609.344;
const METRES_PER_FOOT = 0.3048;

/**
 * Distance in the units the user thinks in.
 *
 * The unit is a parameter rather than a lookup so these stay pure functions --
 * every caller already sits inside a tool that knows the profile, and reaching
 * for a database from a string formatter is how a formatter becomes untestable.
 *
 * This exists because the setting shipped before the conversion did: the
 * profile accepted `imperial`, the system prompt told the model to answer in
 * miles, and every number it was given was still in kilometres. A setting that
 * claims to change the units and does not is worse than no setting -- the
 * reader has no way to tell which one they are looking at.
 */
export function formatDistanceMeters(
  meters: number | null | undefined,
  units: "metric" | "imperial" = "metric"
): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) {
    return "n/a";
  }

  if (units === "imperial") {
    // A quarter of a mile is the point below which a runner thinks in feet.
    if (meters >= METRES_PER_MILE / 4) {
      return `${(meters / METRES_PER_MILE).toFixed(2)} mi`;
    }
    return `${(meters / METRES_PER_FOOT).toFixed(0)} ft`;
  }

  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }

  return `${meters.toFixed(0)} m`;
}

export function formatPaceMetersPerSecond(
  metersPerSecond: number | null | undefined,
  units: "metric" | "imperial" = "metric"
): string {
  if (
    metersPerSecond === null ||
    metersPerSecond === undefined ||
    !Number.isFinite(metersPerSecond) ||
    metersPerSecond <= 0
  ) {
    return "n/a";
  }

  const perUnit = units === "imperial" ? METRES_PER_MILE : 1000;
  const secondsPerUnit = perUnit / metersPerSecond;
  const minutes = Math.floor(secondsPerUnit / 60);
  const seconds = Math.round(secondsPerUnit % 60);

  // 4:60 /km is not a pace. Rounding the seconds can carry, and the carry has
  // to reach the minutes or the string is wrong once every sixty paces.
  const carried = seconds === 60;
  const finalMinutes = carried ? minutes + 1 : minutes;
  const finalSeconds = carried ? 0 : seconds;

  return `${finalMinutes}:${finalSeconds.toString().padStart(2, "0")} ${units === "imperial" ? "/mi" : "/km"}`;
}

export function calculateTrend(values: number[], lowerIsBetter = false): TrendDirection {
  const filtered = values.filter((value) => Number.isFinite(value));

  if (filtered.length < 2) {
    return "insufficient_data";
  }

  const midpoint = Math.floor(filtered.length / 2);
  const recent = filtered.slice(0, midpoint);
  const older = filtered.slice(midpoint);

  if (recent.length === 0 || older.length === 0) {
    return "insufficient_data";
  }

  const recentAverage = average(recent);
  const olderAverage = average(older);
  const delta = recentAverage - olderAverage;
  const threshold = Math.max(Math.abs(olderAverage) * 0.02, 0.5);

  if (Math.abs(delta) <= threshold) {
    return "stable";
  }

  if (lowerIsBetter) {
    return delta < 0 ? "improving" : "declining";
  }

  return delta > 0 ? "improving" : "declining";
}

export function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function hashParams(params: Record<string, unknown>): string {
  const sortedEntries = Object.entries(params).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(Object.fromEntries(sortedEntries));
}

export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/(?:[A-Za-z]:\\|\/)[^\s]+/g, "[path]")
    .replace(/\bpassword[^\s]*/gi, "[redacted]");
}
