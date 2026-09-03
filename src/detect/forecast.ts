import { dailyTrimp, estimateHrProfile } from "./trimp.js";
import type { DetectorInput } from "./findings.js";

// SECTION: Training load forecast
//
// The acute:chronic ratio detector says where the ratio is. It fires after the
// jump, which is the wrong side of the event: the value of the ratio is that it
// warns you *before* the week that hurts you, and a warning that arrives once
// the week is over is a diary entry.
//
// This projects the ratio forward one week on the only assumption the data
// itself supports: that the next seven days look like the last seven. It is an
// extrapolation and it is labelled as one. Nothing here asks the user to record
// a plan, because a forecast that depends on the user diligently logging their
// intentions is a forecast that will be wrong exactly when they are busy -- and
// being busy is correlated with the training weeks that go wrong.

const ACUTE_DAYS = 7;
const CHRONIC_DAYS = 28;
const RATIO_HIGH = 1.5;
const RATIO_LOW = 0.8;
const MIN_CHRONIC_COVERAGE_DAYS = 21;

export type LoadTrajectory = "rising" | "falling" | "steady";
export type LoadVerdict = "spike_ahead" | "detraining_ahead" | "on_track" | "unknown";

export interface LoadForecast {
  /** Where the ratio is today. Null when there is not enough history to say. */
  currentRatio: number | null;
  /** Where it lands in seven days if this week repeats. */
  projectedRatio: number | null;
  trajectory: LoadTrajectory;
  verdict: LoadVerdict;
  /** TRIMP over the last seven days. */
  acuteLoad: number;
  /** TRIMP over the last 28 days, expressed as a weekly figure. */
  chronicWeeklyLoad: number;
  /**
   * How much this week's load would have to change to land inside the safe
   * band. Positive means add load, negative means shed it. Null when already
   * inside the band or when there is nothing to compare against.
   */
  weeklyLoadAdjustment: number | null;
  /** Plain sentence for a watch screen or a model prompt. Never medical. */
  summary: string;
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * The projection has to move the whole 28-day window, not just add to it.
 *
 * A week from now the chronic window has dropped its oldest seven days and
 * gained the seven we are projecting. Holding chronic fixed and only advancing
 * acute overstates the ratio whenever the dropped week was heavy -- which is
 * precisely the case where the user most needs the number to be right.
 */
export function forecastLoad(input: DetectorInput): LoadForecast {
  const unknown: LoadForecast = {
    currentRatio: null,
    projectedRatio: null,
    trajectory: "steady",
    verdict: "unknown",
    acuteLoad: 0,
    chronicWeeklyLoad: 0,
    weeklyLoadAdjustment: null,
    summary: "Not enough training history yet to project a load ratio.",
  };

  const profile = estimateHrProfile(
    input.series("resting_hr", CHRONIC_DAYS),
    input.series("max_hr", CHRONIC_DAYS)
  );
  if (!profile) {
    return unknown;
  }

  if (input.series("resting_hr", CHRONIC_DAYS).length < MIN_CHRONIC_COVERAGE_DAYS) {
    return unknown;
  }

  const byDay = dailyTrimp(input.activities(CHRONIC_DAYS + ACUTE_DAYS), profile);
  const today = input.now.startOf("day");

  const sumWindow = (fromDaysAgo: number, days: number): number => {
    let total = 0;
    for (let offset = fromDaysAgo; offset < fromDaysAgo + days; offset += 1) {
      const date = today.minus({ days: offset }).toISODate();
      if (date) {
        total += byDay.get(date) ?? 0;
      }
    }
    return total;
  };

  const acute = sumWindow(0, ACUTE_DAYS);
  const chronicTotal = sumWindow(0, CHRONIC_DAYS);
  const chronicWeekly = chronicTotal / (CHRONIC_DAYS / ACUTE_DAYS);

  if (chronicWeekly <= 0) {
    return { ...unknown, acuteLoad: round(acute), chronicWeeklyLoad: 0 };
  }

  const currentRatio = round(acute / chronicWeekly);

  // Slide the 28-day window forward seven days: drop the oldest week, add the
  // week we are assuming.
  const oldestWeek = sumWindow(CHRONIC_DAYS - ACUTE_DAYS, ACUTE_DAYS);
  const projectedChronicTotal = chronicTotal - oldestWeek + acute;
  const projectedChronicWeekly = projectedChronicTotal / (CHRONIC_DAYS / ACUTE_DAYS);

  if (projectedChronicWeekly <= 0) {
    return {
      ...unknown,
      currentRatio,
      acuteLoad: round(acute),
      chronicWeeklyLoad: round(chronicWeekly),
    };
  }

  const projectedRatio = round(acute / projectedChronicWeekly);

  const trajectory: LoadTrajectory =
    projectedRatio > currentRatio + 0.05
      ? "rising"
      : projectedRatio < currentRatio - 0.05
        ? "falling"
        : "steady";

  let verdict: LoadVerdict = "on_track";
  if (projectedRatio > RATIO_HIGH) {
    verdict = "spike_ahead";
  } else if (projectedRatio < RATIO_LOW) {
    verdict = "detraining_ahead";
  }

  // What this week's load would have to be to sit on the edge of the band.
  // Solved against the projected chronic window, which is the one the ratio
  // will actually be measured against.
  let weeklyLoadAdjustment: number | null = null;
  if (verdict === "spike_ahead") {
    weeklyLoadAdjustment = round(RATIO_HIGH * projectedChronicWeekly - acute, 0);
  } else if (verdict === "detraining_ahead") {
    weeklyLoadAdjustment = round(RATIO_LOW * projectedChronicWeekly - acute, 0);
  }

  const provenance =
    "Load is TRIMP, computed here from duration and heart rate, and this is an extrapolation of the last seven days rather than a plan you have entered.";

  const summary =
    verdict === "spike_ahead"
      ? `Repeating this week puts your load ratio at ${projectedRatio}x, above the ${RATIO_HIGH}x mark where injury risk climbs. ${provenance}`
      : verdict === "detraining_ahead"
        ? `Repeating this week puts your load ratio at ${projectedRatio}x, below the ${RATIO_LOW}x mark where fitness starts to slip. ${provenance}`
        : `Repeating this week keeps your load ratio near ${projectedRatio}x, inside the steady band. ${provenance}`;

  return {
    currentRatio,
    projectedRatio,
    trajectory,
    verdict,
    acuteLoad: round(acute, 0),
    chronicWeeklyLoad: round(chronicWeekly, 0),
    weeklyLoadAdjustment,
    summary,
  };
}
