import { mapInBatches } from "../utils/batch.js";
import { logger } from "../utils/logger.js";

/**
 * Every per-day tool used to write `catch { return null }` around its fetch and
 * then filter the nulls away, which collapsed two different facts into one
 * empty array: "the user did not wear the watch" and "Garmin would not answer".
 * `withCache` then persisted that array for the full success TTL, so a single
 * rate-limited minute made the tool report "No sleep data found for the last 7
 * nights" for the next two hours -- an assertion about the user's life, made
 * from a failed request.
 *
 * A day that could not be fetched is now counted rather than discarded, so the
 * renderer can say which of the two happened and the cache can refuse to keep a
 * degraded answer for long.
 */
export interface DayFetchResult<T> {
  /** Days that answered with a real measurement. */
  values: T[];
  /** Days whose request failed. NOT days with nothing recorded. */
  unreachableDays: number;
  /** Days asked for, so a caller can say "3 of 30". */
  requestedDays: number;
}

export async function fetchEachDay<T, D>(
  dates: D[],
  fetchOne: (date: D) => Promise<T | null | undefined>,
  source: string
): Promise<DayFetchResult<T>> {
  let unreachableDays = 0;

  const mapped = await mapInBatches(dates, async (date) => {
    try {
      return await fetchOne(date);
    } catch (error) {
      unreachableDays += 1;
      logger.debug({ err: error, date: String(date), source }, "Day fetch failed");
      return null;
    }
  });

  return {
    values: mapped.filter((value): value is T => value !== null && value !== undefined),
    unreachableDays,
    requestedDays: dates.length,
  };
}

/** True when part of the answer is missing because a request failed. */
export function isPartial(result: { unreachableDays: number }): boolean {
  return result.unreachableDays > 0;
}

/**
 * The one sentence that keeps "nothing was recorded" and "nothing could be
 * fetched" from rendering the same. Returns "" when the fetch was complete.
 */
export function partialFetchNote(result: DayFetchResult<unknown>, noun: string): string {
  if (result.unreachableDays === 0) {
    return "";
  }

  if (result.values.length === 0) {
    return `Could not reach Garmin for any of the last ${result.requestedDays} ${noun}. This is not the same as having no ${noun} recorded — try again shortly.`;
  }

  return `Note: ${result.unreachableDays} of ${result.requestedDays} ${noun} could not be fetched, so these figures cover only what was retrieved.`;
}
