import { DateTime } from "luxon";
import type { ActivitySummary } from "../garmin/types.js";

export type TrendDirection = "improving" | "declining" | "stable" | "insufficient_data";

export function parseIsoDate(value: string): Date {
  const parsed = DateTime.fromISO(value, { zone: "utc" });
  if (!parsed.isValid) {
    throw new Error(`Invalid date "${value}". Use ISO 8601 format such as 2026-06-01.`);
  }
  return parsed.toJSDate();
}

export function formatIsoDate(date: Date): string {
  return DateTime.fromJSDate(date, { zone: "utc" }).toISODate() ?? "";
}

export function getDateRange(days: number): Date[] {
  const dates: Date[] = [];
  const today = DateTime.utc().startOf("day");

  for (let offset = 0; offset < days; offset += 1) {
    dates.push(today.minus({ days: offset }).toJSDate());
  }

  return dates;
}

export function getYesterday(): Date {
  return DateTime.utc().minus({ days: 1 }).startOf("day").toJSDate();
}

export function getDatesBetween(startDate: string, endDate: string): Date[] {
  const start = DateTime.fromISO(startDate, { zone: "utc" }).startOf("day");
  const end = DateTime.fromISO(endDate, { zone: "utc" }).startOf("day");

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
  const start = DateTime.fromISO(startDate, { zone: "utc" }).startOf("day");
  const end = DateTime.fromISO(endDate, { zone: "utc" }).startOf("day");

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

export function formatDistanceMeters(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) {
    return "n/a";
  }

  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }

  return `${meters.toFixed(0)} m`;
}

export function formatPaceMetersPerSecond(metersPerSecond: number | null | undefined): string {
  if (
    metersPerSecond === null ||
    metersPerSecond === undefined ||
    !Number.isFinite(metersPerSecond) ||
    metersPerSecond <= 0
  ) {
    return "n/a";
  }

  const secondsPerKm = 1000 / metersPerSecond;
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")} /km`;
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
