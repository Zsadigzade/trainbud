import type { MetricPoint, StoredActivity } from "../history/store.js";
import { clamp } from "../utils/helpers.js";

// SECTION: Training load
//
// The activity payload this project fetches carries no load at all -- no
// activityTrainingLoad, no training effect, no zone time -- so Garmin's own
// number is not available, and where it does exist it is absent for many
// activity types. Banister TRIMP needs only duration and average heart rate,
// which every recorded activity has, and the definition is ours and testable
// rather than opaque and undocumented.
//
//   HRr   = (avgHr - restingHr) / (maxHr - restingHr)   clamped to [0, 1]
//   TRIMP = minutes x HRr x 0.64 x e^(1.92 x HRr)
//
// The exponential is what makes an hour hard worth more than two hours easy.
//
// This will not match anything Connect shows, because Connect is not computing
// TRIMP. Anything that surfaces the number says so.

const INTENSITY_COEFFICIENT = 0.64;
const INTENSITY_EXPONENT = 1.92;

export interface HrProfile {
  restingHr: number;
  maxHr: number;
}

/**
 * `maxHr` is the highest daily maximum ever recorded, which is an *observed*
 * maximum rather than a true one -- the user may simply never have gone that
 * hard. It is the best available without asking their age, and it errs toward
 * rating sessions harder rather than softer, which is the safer direction for a
 * load warning.
 */
export function estimateHrProfile(
  restingPoints: MetricPoint[],
  maxPoints: MetricPoint[]
): HrProfile | null {
  const resting = restingPoints
    .map((point) => point.value)
    .filter((value) => Number.isFinite(value) && value > 0);
  const maxima = maxPoints
    .map((point) => point.value)
    .filter((value) => Number.isFinite(value) && value > 0);

  if (resting.length === 0 || maxima.length === 0) {
    return null;
  }

  const restingHr = Math.min(...resting);
  const maxHr = Math.max(...maxima);

  if (maxHr <= restingHr) {
    return null;
  }

  return { restingHr, maxHr };
}

/**
 * Null, never zero, when the session cannot be scored. A zero is a claim that
 * the session was easy; null is the truth, which is that a strength session
 * recorded without a heart rate says nothing about load either way.
 */
export function trimpFor(activity: StoredActivity, profile: HrProfile): number | null {
  const { avgHr, durationSeconds } = activity;

  if (avgHr === null || durationSeconds === null) {
    return null;
  }
  if (!Number.isFinite(avgHr) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }

  const range = profile.maxHr - profile.restingHr;
  if (range <= 0) {
    return null;
  }

  const reserve = clamp((avgHr - profile.restingHr) / range, 0, 1);
  const minutes = durationSeconds / 60;

  return (
    minutes * reserve * INTENSITY_COEFFICIENT * Math.exp(INTENSITY_EXPONENT * reserve)
  );
}

/** Load per calendar day. Two sessions on one date sum into a single entry. */
export function dailyTrimp(
  activities: StoredActivity[],
  profile: HrProfile
): Map<string, number> {
  const byDay = new Map<string, number>();

  for (const activity of activities) {
    const score = trimpFor(activity, profile);
    if (score === null) {
      continue;
    }

    byDay.set(activity.date, (byDay.get(activity.date) ?? 0) + score);
  }

  return byDay;
}
