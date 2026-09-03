import { median } from "./baseline.js";
import { forecastLoad, type LoadForecast } from "./forecast.js";
import { analyseSleep, type SleepQuality } from "./sleepQuality.js";
import { dailyTrimp, estimateHrProfile } from "./trimp.js";
import type { DetectorInput } from "./findings.js";
import type { MetricKind } from "../history/schema.js";

// SECTION: Weekly review
//
// Every other surface in this app answers "how am I today". None of them
// answers "how was the week", which is the unit training is actually planned
// in -- and it is the question the store has been able to answer since the
// memory layer landed without anything ever asking it.
//
// Each line is this week against last week, both measured from the same store,
// so the comparison is like for like. Where a metric is missing on either side
// the line says so rather than showing a delta against zero: an unworn watch is
// not a resting heart rate of nothing, and this project's bug history is full
// of absences that were rendered as measurements.

const WEEK_DAYS = 7;

export type Direction = "up" | "down" | "flat" | "unknown";

export interface WeekMetric {
  key: string;
  label: string;
  unit: string;
  current: number | null;
  previous: number | null;
  delta: number | null;
  direction: Direction;
  /** True when the change is large enough to be worth reading. */
  notable: boolean;
}

export interface WeekReview {
  start: string;
  end: string;
  /** False when there is not enough history for the comparison to mean anything. */
  ready: boolean;
  sessions: number;
  previousSessions: number;
  movingMinutes: number;
  previousMovingMinutes: number;
  metrics: WeekMetric[];
  forecast: LoadForecast;
  sleep: SleepQuality;
  headline: string;
}

/** Two full weeks, because the review is a comparison and one week compares to nothing. */
const READY_DAYS = 14;

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function directionFor(delta: number | null, threshold: number): Direction {
  if (delta === null) {
    return "unknown";
  }
  if (Math.abs(delta) < threshold) {
    return "flat";
  }
  return delta > 0 ? "up" : "down";
}

/**
 * Splits a series into this week and the week before by date rather than by
 * position. Position slicing silently misaligns the moment a day is missing --
 * fourteen points is not necessarily fourteen consecutive days, and on this
 * store it usually is not.
 */
function weekHalves(
  input: DetectorInput,
  kind: MetricKind
): { current: number[]; previous: number[] } {
  const today = input.now.startOf("day");
  const cutoff = today.minus({ days: WEEK_DAYS }).toISODate() ?? "";
  const points = input.series(kind, WEEK_DAYS * 2);

  const current: number[] = [];
  const previous: number[] = [];

  for (const point of points) {
    if (point.date > cutoff) {
      current.push(point.value);
    } else {
      previous.push(point.value);
    }
  }

  return { current, previous };
}

function metricFrom(
  key: string,
  label: string,
  unit: string,
  current: number[],
  previous: number[],
  options: { scale?: number; places?: number; notableDelta: number }
): WeekMetric {
  const scale = options.scale ?? 1;
  const places = options.places ?? 1;

  const currentValue = median(current);
  const previousValue = median(previous);

  const scaled = currentValue === null ? null : round(currentValue / scale, places);
  const scaledPrevious = previousValue === null ? null : round(previousValue / scale, places);
  const delta =
    scaled === null || scaledPrevious === null ? null : round(scaled - scaledPrevious, places);

  return {
    key,
    label,
    unit,
    current: scaled,
    previous: scaledPrevious,
    delta,
    direction: directionFor(delta, options.notableDelta),
    notable: delta !== null && Math.abs(delta) >= options.notableDelta,
  };
}

export function buildWeekReview(input: DetectorInput): WeekReview {
  const today = input.now.startOf("day");
  const start = today.minus({ days: WEEK_DAYS - 1 }).toISODate() ?? "";
  const end = today.toISODate() ?? "";
  const cutoff = today.minus({ days: WEEK_DAYS }).toISODate() ?? "";

  const activities = input.activities(WEEK_DAYS * 2);
  const thisWeek = activities.filter((activity) => activity.date > cutoff);
  const lastWeek = activities.filter((activity) => activity.date <= cutoff);

  const movingSeconds = (list: typeof activities): number =>
    list.reduce((total, activity) => total + (activity.durationSeconds ?? 0), 0);

  const sleep = weekHalves(input, "sleep_seconds");
  const restingHr = weekHalves(input, "resting_hr");
  const hrv = weekHalves(input, "hrv_overnight");
  const stress = weekHalves(input, "stress_avg");

  const metrics: WeekMetric[] = [
    metricFrom("sleep", "Sleep", "h", sleep.current, sleep.previous, {
      scale: SECONDS_PER_HOUR,
      notableDelta: 0.5,
    }),
    metricFrom("resting_hr", "Resting HR", "bpm", restingHr.current, restingHr.previous, {
      places: 0,
      notableDelta: 2,
    }),
    metricFrom("hrv", "HRV", "ms", hrv.current, hrv.previous, {
      places: 0,
      notableDelta: 5,
    }),
    metricFrom("stress", "Stress", "", stress.current, stress.previous, {
      places: 0,
      notableDelta: 5,
    }),
  ];

  // Load gets its own line: it is a sum over the week, not a typical day, so
  // taking a median of it the way the wellness metrics are taken would be
  // meaningless.
  const profile = estimateHrProfile(
    input.series("resting_hr", WEEK_DAYS * 4),
    input.series("max_hr", WEEK_DAYS * 4)
  );

  if (profile) {
    const byDay = dailyTrimp(activities, profile);
    const sumWindow = (fromDaysAgo: number): number => {
      let total = 0;
      for (let offset = fromDaysAgo; offset < fromDaysAgo + WEEK_DAYS; offset += 1) {
        const date = today.minus({ days: offset }).toISODate();
        if (date) {
          total += byDay.get(date) ?? 0;
        }
      }
      return total;
    };

    const currentLoad = Math.round(sumWindow(0));
    const previousLoad = Math.round(sumWindow(WEEK_DAYS));
    const delta = currentLoad - previousLoad;

    metrics.unshift({
      key: "load",
      label: "Load",
      unit: "TRIMP",
      current: currentLoad,
      previous: previousLoad,
      delta,
      direction: directionFor(delta, Math.max(20, previousLoad * 0.15)),
      notable: Math.abs(delta) >= Math.max(20, previousLoad * 0.15),
    });
  }

  const coverageDays = Math.max(
    input.series("resting_hr", WEEK_DAYS * 2).length,
    input.series("sleep_seconds", WEEK_DAYS * 2).length
  );
  const ready = coverageDays >= READY_DAYS;

  const forecast = forecastLoad(input);
  const sleepQuality = analyseSleep(input);

  const notable = metrics.filter((metric) => metric.notable);
  const headline = !ready
    ? `Only ${coverageDays} of the last 14 days are recorded, so this week cannot be compared to last week yet.`
    : notable.length === 0
      ? `${thisWeek.length} session${thisWeek.length === 1 ? "" : "s"} this week, and nothing moved much against last week.`
      : `${thisWeek.length} session${thisWeek.length === 1 ? "" : "s"} this week. ` +
        notable
          .map(
            (metric) =>
              `${metric.label} ${metric.direction === "up" ? "up" : "down"} ${Math.abs(metric.delta ?? 0)}${metric.unit}`
          )
          .join(", ") +
        " versus last week.";

  return {
    start,
    end,
    ready,
    sessions: thisWeek.length,
    previousSessions: lastWeek.length,
    movingMinutes: Math.round(movingSeconds(thisWeek) / SECONDS_PER_MINUTE),
    previousMovingMinutes: Math.round(movingSeconds(lastWeek) / SECONDS_PER_MINUTE),
    metrics,
    forecast,
    sleep: sleepQuality,
    headline,
  };
}
