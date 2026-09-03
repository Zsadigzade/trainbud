import { executeTool } from "./tools/index.js";
import { generateDailyInsight, isAiConfigured } from "./promptApi.js";
import { DateTime } from "luxon";
import { buildDetectorInput, runDetectors } from "./detect/index.js";
import { restingHrDeltaBpm } from "./detect/detectors.js";
import {
  getProfile,
  stateFor,
  visibleCards,
  type MetricState,
} from "./profile.js";
import { budgetState } from "./usage.js";
import { buildWeekReview, type WeekReview } from "./detect/week.js";
import { nextRace, type RaceCountdown } from "./detect/countdown.js";
import { buildPromptSuggestions } from "./promptSuggestions.js";
import { activeContext, upcomingContext, type ContextEntry } from "./history/context.js";
import type { Finding } from "./detect/findings.js";
import type { RecoveryStatusResult } from "./garmin/types.js";
import type {
  HeartRatePayload,
  LatestActivityPayload,
  RecoveryPayload,
  SleepPayload,
  StressPayload,
  Vo2MaxPayload,
} from "./tools/payloads.js";

// SECTION: Watch API
//
// The watch reads this JSON and nothing else, so the shapes below are a
// contract with a build that is already on someone's wrist: fields may be
// added, never renamed or removed.
//
// These used to be reconstructed by matching regexes against the prose each
// tool printed -- `Recovery score:\s*(null|\d+)\/100`, `(\d+)h`, `resting \d+
// bpm, max (\d+) bpm`. That made every renderer's wording load-bearing for the
// watch while looking like formatting, and none of it was covered by a test.
// The tools now return typed payloads and these are plain mappers over them.

export interface WatchRecovery {
  score: number;
  label: string;
}

export interface WatchSleep {
  hours: number;
  score: number | null;
  label: string;
}

export interface WatchActivity {
  name: string;
  distance_km: number | null;
  duration_min: number | null;
  avg_hr: number | null;
  date: string;
}

export interface WatchHeartRate {
  resting: number;
  max: number | null;
}

export interface WatchDailyOverview {
  recovery: number | null;
  sleep_h: number | null;
  stress: number | null;
  vo2max: number | null;
}

export interface WatchStress {
  avg: number;
  label: string;
}

export interface WatchVo2Max {
  value: number;
  trend: string;
}

/**
 * The watch gets the sentence, not the numbers to build one. It cannot wrap
 * arbitrary text well -- a fixed-font activity name already clips on a 390 px
 * round screen -- so the detail paragraph and the raw values stay on the server.
 */
export interface WatchFinding {
  kind: string;
  severity: string;
  headline: string;
}

export interface WatchCoverage {
  days: number;
  ready: boolean;
  /** Newest date the store holds any measurement for, or null when empty. */
  throughDate: string | null;
  /**
   * How many days old that is. `ready` is false once this passes the grace
   * period: a store that stopped three weeks ago has plenty of days and nothing
   * recent to compare, and "nothing stands out" would be a claim about a day
   * that was never recorded.
   */
  staleDays: number;
}

/**
 * The week, compressed to what a 208 px screen can hold.
 *
 * Deliberately a handful of scalars rather than the whole WeekReview: the watch
 * response is parsed on the device, a body Connect IQ cannot hold comes back as
 * -402 NETWORK_RESPONSE_TOO_LARGE, and every field here has to be drawn by hand
 * anyway. The full review stays on the server, where `get_week_review` and the
 * dashboard can render it in as much detail as they like.
 */
export interface WatchWeek {
  sessions: number;
  previous_sessions: number;
  moving_minutes: number;
  /** TRIMP this week against last week, as a whole-number percentage. */
  load_delta_pct: number | null;
  sleep_debt_h: number | null;
  /** This person's own habitual night, in hours. Not eight. */
  sleep_habitual_h: number | null;
  sleep_consistency: "steady" | "variable" | "erratic" | "unknown";
  /** Where the acute:chronic ratio lands if next week repeats this one. */
  forecast_ratio: number | null;
  forecast_verdict: "spike_ahead" | "detraining_ahead" | "on_track" | "unknown";
  ready: boolean;
  headline: string;
}

export interface WatchRace {
  text: string;
  days_away: number;
  phase: "race_week" | "taper" | "build" | "far_out";
}

/**
 * What each metric means, already decided.
 *
 * The watch used to grade these itself: `recoveryColor`, `sleepColor`,
 * `stressColor` and `heartRateColor` were four copies of four thresholds in
 * Monkey C, so the wrist and the browser could disagree about whether the same
 * score was good, and nothing reconciled them. Personalising the bands would
 * have made that disagreement permanent -- the watch has no idea what the user
 * set in the dashboard, and shipping the numbers to it would mean two
 * implementations of the same comparison, one of which is in a language with
 * no tests.
 *
 * So the server grades, and the watch colours. `unknown` is a real answer and
 * has to survive to the screen: an unworn watch is not a recovery score of
 * zero, and a card that renders an absence in red has invented a measurement.
 */
export interface WatchStates {
  recovery: MetricState;
  sleep: MetricState;
  stress: MetricState;
  resting_hr: MetricState;
}

/**
 * How this user wants the app to look, resolved for a client that cannot ask.
 *
 * `cards` is the visible carousel in the user's order, by id. The watch walks
 * this list instead of its own compiled-in constants, so hiding a card or
 * moving one happens in the dashboard and is live on the next fetch -- no
 * Connect IQ settings sync, no store update.
 */
export interface WatchDisplay {
  name: string | null;
  units: "metric" | "imperial";
  cards: string[];
}

/**
 * The worst thing standing out right now, as one number the watch can badge.
 *
 * Findings are already on the payload, but reading them means parsing an array
 * on a device where that costs memory, and the glance view has room for a dot
 * and nothing else.
 */
export interface WatchAlert {
  level: "none" | "notice" | "warn";
  count: number;
}

/**
 * Whether an Ask would be refused before the watch spends a round trip finding
 * out.
 *
 * `exceeded` is only ever true when the user set a cap themselves; there is no
 * default ceiling. `incomplete` says the total behind that decision is a floor
 * rather than a total, because some calls could not be priced.
 */
export interface WatchBudget {
  exceeded: boolean;
  incomplete: boolean;
}

export interface WatchSummary {
  daily_overview: WatchDailyOverview;
  recovery: WatchRecovery | null;
  sleep: WatchSleep | null;
  activity: WatchActivity | null;
  stress: WatchStress | null;
  vo2max: WatchVo2Max | null;
  heart_rate: WatchHeartRate | null;
  findings: WatchFinding[];
  coverage: WatchCoverage;
  /** This week against last week. Null on a server too old to compute it. */
  week: WatchWeek | null;
  /** The next race on record, or null when nothing is on the calendar. */
  race: WatchRace | null;
  /**
   * The five Ask prompts for today. The watch reads these instead of the
   * hardcoded strings in strings.xml, so the menu asks about what actually
   * happened rather than the same five questions every day.
   */
  prompts: string[];
  ai_insight: string | null;
  /**
   * Whether an AI key is configured at all, from either the dashboard or the
   * environment.
   *
   * ai_insight being null does not answer that question: it is also null when
   * a key exists and the call failed, and when today's insight has simply not
   * been generated yet. The watch drew one "AI unavailable" screen for all
   * three, which told the user nothing they could act on -- the same fault the
   * single "Pairing failed" message had. With this flag the watch can say
   * "AI is not set up" and name the dashboard.
   */
  ai_configured: boolean;
  /** Each metric already graded against this user's own bands. */
  states: WatchStates;
  /** Name, units and the visible carousel, in the user's order. */
  display: WatchDisplay;
  /** The worst finding right now, as one badge-able level. */
  alert: WatchAlert;
  /** Whether the user's own AI spending cap would refuse an Ask. */
  budget: WatchBudget;
  updated_at: string;
}

// SECTION: Payload to card mappers

const RECOVERY_LABELS: Record<RecoveryStatusResult["status"], string> = {
  recovered: "Ready",
  good: "Light",
  fatigued: "Rest",
};

export function toWatchRecovery(payload: RecoveryPayload | null): WatchRecovery | null {
  if (!payload) {
    return null;
  }

  return {
    score: payload.recovery.score,
    label: RECOVERY_LABELS[payload.recovery.status],
  };
}

export function toWatchSleep(payload: SleepPayload | null): WatchSleep | null {
  const night = payload?.nights[0];
  if (!payload || !night) {
    return null;
  }

  const score = night.sleepScore ?? payload.averageScore;

  // "Fair" was the default, so a night Garmin never scored was labelled as
  // though it had been assessed and found middling. Every branch below tests
  // `score !== null` and the fall-through case is exactly the one where there is
  // no score at all -- a verdict on a measurement that does not exist. The
  // duration is still real and still worth showing; the judgement is not.
  let label = "";
  if (score !== null && score >= 80) {
    label = "Great";
  } else if (score !== null && score >= 60) {
    label = "Good";
  } else if (score !== null && score > 0) {
    label = "Poor";
  }

  return {
    hours: Math.round((night.totalSleepSeconds / 3600) * 10) / 10,
    score,
    label,
  };
}

export function toWatchActivity(payload: LatestActivityPayload | null): WatchActivity | null {
  const activity = payload?.activity;
  if (!activity) {
    return null;
  }

  return {
    name: activity.name,
    distance_km:
      activity.distanceMeters === null
        ? null
        : Math.round((activity.distanceMeters / 1000) * 100) / 100,
    duration_min:
      activity.durationSeconds === null ? null : Math.round(activity.durationSeconds / 60),
    avg_hr: activity.averageHeartRate,
    date: activity.startTimeLocal,
  };
}

function stressLabel(avg: number): string {
  if (avg <= 25) {
    return "Low";
  }
  if (avg <= 50) {
    return "Medium";
  }
  return "High";
}

export function toWatchStress(payload: StressPayload | null): WatchStress | null {
  if (!payload || payload.averageStress === null) {
    return null;
  }

  return { avg: payload.averageStress, label: stressLabel(payload.averageStress) };
}

export function toWatchVo2Max(payload: Vo2MaxPayload | null): WatchVo2Max | null {
  if (!payload || payload.current === null) {
    return null;
  }

  return { value: Math.round(payload.current * 10) / 10, trend: payload.trend };
}

export function toWatchHeartRate(payload: HeartRatePayload | null): WatchHeartRate | null {
  if (!payload || payload.currentResting === null) {
    return null;
  }

  return { resting: payload.currentResting, max: payload.days[0]?.maxHeartRate ?? null };
}

// SECTION: Summary assembly

export function toWatchFindings(findings: Finding[]): WatchFinding[] {
  return findings.map((finding) => ({
    kind: finding.kind,
    severity: finding.severity,
    headline: finding.headline,
  }));
}

export interface WatchSummaryParts {
  recovery: RecoveryPayload | null;
  sleep: SleepPayload | null;
  activity: LatestActivityPayload | null;
  stress: StressPayload | null;
  vo2max: Vo2MaxPayload | null;
  heartRate: HeartRatePayload | null;
  findings: Finding[];
  coverage: WatchCoverage;
  context: ContextEntry[];
  week: WeekReview | null;
  race: RaceCountdown | null;
  updatedAt: string;
  aiConfigured: boolean;
  /**
   * Distance from this person's own resting-HR median, or null when there is
   * not yet enough history to have one. Null and zero are different answers
   * and the grading has to be able to tell them apart.
   */
  restingHrDeltaBpm: number | null;
}

/**
 * The worst severity among the findings, and how many there are.
 *
 * `info` deliberately does not raise the level above `none`: an informational
 * finding is worth a line on the Today card and is not worth a badge on a
 * watch face.
 */
export function toWatchAlert(findings: Finding[]): WatchAlert {
  const level = findings.some((f) => f.severity === "warn")
    ? "warn"
    : findings.some((f) => f.severity === "notice")
      ? "notice"
      : "none";
  return { level, count: findings.length };
}

/** Percent change, or null when the earlier figure is zero and a percentage of
    nothing would be either infinite or a lie. */
function percentDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) {
    return null;
  }
  return Math.round(((current - previous) / previous) * 100);
}

export function toWatchWeek(review: WeekReview | null): WatchWeek | null {
  if (!review) {
    return null;
  }

  const load = review.metrics.find((metric) => metric.key === "load");

  return {
    sessions: review.sessions,
    previous_sessions: review.previousSessions,
    moving_minutes: review.movingMinutes,
    load_delta_pct: percentDelta(load?.current ?? null, load?.previous ?? null),
    sleep_debt_h: review.sleep.debtHours,
    sleep_habitual_h: review.sleep.habitualHours,
    sleep_consistency: review.sleep.consistency,
    forecast_ratio: review.forecast.projectedRatio,
    forecast_verdict: review.forecast.verdict,
    ready: review.ready,
    headline: review.headline,
  };
}

export function toWatchRace(race: RaceCountdown | null): WatchRace | null {
  return race
    ? { text: race.text, days_away: race.daysAway, phase: race.phase }
    : null;
}

export function buildWatchSummaryFrom(
  parts: WatchSummaryParts
): Omit<WatchSummary, "ai_insight"> {
  const recovery = toWatchRecovery(parts.recovery);
  const sleep = toWatchSleep(parts.sleep);
  const stress = toWatchStress(parts.stress);
  const vo2max = toWatchVo2Max(parts.vo2max);
  // Read once. Every grade below has to come from the same profile: reading it
  // per metric would let a save land mid-assembly and colour half the payload
  // against the old bands.
  const profile = getProfile();

  return {
    daily_overview: {
      recovery: recovery?.score ?? null,
      sleep_h: sleep?.hours ?? null,
      stress: stress?.avg ?? null,
      vo2max: vo2max?.value ?? null,
    },
    recovery,
    sleep,
    activity: toWatchActivity(parts.activity),
    stress,
    vo2max,
    heart_rate: toWatchHeartRate(parts.heartRate),
    findings: toWatchFindings(parts.findings),
    coverage: parts.coverage,
    week: toWatchWeek(parts.week),
    race: toWatchRace(parts.race),
    prompts: buildPromptSuggestions(
      { findings: parts.findings, coverage: parts.coverage },
      parts.context
    ),
    ai_configured: parts.aiConfigured,
    states: {
      recovery: stateFor("recovery", recovery?.score ?? null),
      sleep: stateFor("sleepHours", sleep?.hours ?? null),
      stress: stateFor("stress", stress?.avg ?? null),
      // Graded on the distance from this person's own median, not on the rate.
      // 58 bpm is unremarkable for one person and a warning for another, and
      // the absolute number cannot tell them apart.
      resting_hr: stateFor("restingHrDelta", parts.restingHrDeltaBpm),
    },
    display: {
      name: profile.displayName,
      units: profile.units,
      cards: visibleCards(profile),
    },
    alert: toWatchAlert(parts.findings),
    budget: (() => {
      const state = budgetState();
      return { exceeded: state.exceeded, incomplete: state.incomplete };
    })(),
    updated_at: parts.updatedAt,
  };
}

/**
 * One failing tool must not empty the whole screen -- the watch renders each
 * card independently and shows "No data" for the ones that are missing.
 */
async function payloadOf<T>(name: string, args: Record<string, unknown>): Promise<T | null> {
  try {
    const result = await executeTool(name, args);
    return (result.data as T) ?? null;
  } catch {
    return null;
  }
}

/**
 * How old a stored measurement may be before the watch stops drawing it.
 *
 * The tools now answer from TrainBud's own store when Connect will not, which
 * is what an AI client needs -- it can read `storedThrough` and say which day it
 * is describing. THE WATCH CANNOT. Version 1.4.0 is live in the Connect IQ
 * store, it parses this JSON on the device, and it ignores fields it does not
 * know: hand it a sleep card built from 2026-08-21 and it draws "6.4h" under a
 * heading that means last night, on a wrist, with no way for the wearer to tell.
 * A store review takes days, so "ship 1.4.1 and it will render the date" is not
 * an answer for anyone who has already installed it.
 *
 * So the cards take stored data only inside the same grace window the detectors
 * use -- three days, because Garmin finalises a sleep score hours after waking
 * and an unsynced yesterday is normal. Past that the card is null and the watch
 * draws its existing "No data", which is honest.
 *
 * The AI is not gated. `formatFindingsContext` states the record's age in words
 * before the model sees a single number, so the model can hold a fortnight-old
 * figure and say what it is. That asymmetry is the whole point: the surface that
 * can express "as of the 21st" gets the data, and the surface that cannot,
 * does not.
 */
const WATCH_STORED_GRACE_DAYS = 3;

function daysSince(date: string | null | undefined, today: DateTime): number | null {
  if (!date) {
    return null;
  }
  const parsed = DateTime.fromISO(date).startOf("day");
  return parsed.isValid ? Math.max(0, Math.round(today.diff(parsed, "days").days)) : null;
}

/**
 * Drop a card the watch would draw as current when it is not.
 *
 * The test is the age of the NEWEST day in the card, whatever its source --
 * not whether the store was involved. Two reasons that is the right question:
 *
 *   * A partly stored answer whose recent days came off the wire is current
 *     where it matters, because every card's headline figure (`nights[0]`,
 *     `days[0]`) is the newest day.
 *   * The cache could already serve a day-old reading as "current resting HR"
 *     before any of this existed. One rule covers both.
 *
 * With a healthy connection the newest day is today or yesterday, so this is a
 * no-op in the normal case.
 */
export function freshEnoughForWatch<T>(
  payload: T | null,
  newestDate: (payload: T) => string | null | undefined,
  today: DateTime = DateTime.local().startOf("day"),
  graceDays: number = WATCH_STORED_GRACE_DAYS
): T | null {
  if (!payload) {
    return null;
  }

  const age = daysSince(newestDate(payload), today);

  // An undated card is left alone: this exists to catch a date that is too old,
  // not to reject anything it cannot date.
  return age === null || age <= graceDays ? payload : null;
}

export async function buildWatchSummary(): Promise<WatchSummary> {
  // Detection is a local SQLite read, so it costs nothing next to six Garmin
  // round trips and does not need to be raced with them.
  const detection = runDetectors();
  const detectorInput = buildDetectorInput();
  const today = DateTime.local().toISODate() ?? "";
  const weekReview = buildWeekReview(detectorInput);
  const race = nextRace([...activeContext(today), ...upcomingContext(today)], today);

  const [recovery, sleep, activity, stress, vo2max, heartRate] = await Promise.all([
    payloadOf<RecoveryPayload>("get_recovery_status", {}),
    payloadOf<SleepPayload>("get_sleep_data", { nights: 1 }),
    payloadOf<LatestActivityPayload>("get_latest_activity", {}),
    payloadOf<StressPayload>("get_stress_levels", { days: 7 }),
    payloadOf<Vo2MaxPayload>("get_vo2_max_trends", { days: 30 }),
    payloadOf<HeartRatePayload>("get_heart_rate_trends", { days: 7 }),
  ]);

  // See freshEnoughForWatch: the tools may now answer out of the store, and a
  // build already on someone's wrist would draw a fortnight-old figure as
  // today's.
  const startOfToday = DateTime.local().startOf("day");

  const summary: WatchSummary = {
    ...buildWatchSummaryFrom({
      recovery: freshEnoughForWatch(recovery, (payload) => payload.date, startOfToday),
      sleep: freshEnoughForWatch(sleep, (payload) => payload.nights[0]?.date, startOfToday),
      // Exempt: the last activity is dated on its own card and an old one is
      // a fact about the user's training, not a number mislabelled as today's.
      activity,
      stress: freshEnoughForWatch(stress, (payload) => payload.days[0]?.date, startOfToday),
      // Exempt: Connect only recomputes VO2 max after a qualifying activity, so
      // the newest reading is the current one however old it is.
      vo2max,
      heartRate: freshEnoughForWatch(heartRate, (payload) => payload.days[0]?.date, startOfToday),
      findings: detection.findings,
      coverage: detection.coverage,
      context: activeContext(today),
      week: weekReview,
      race,
      updatedAt: new Date().toISOString(),
      aiConfigured: isAiConfigured(),
      restingHrDeltaBpm: restingHrDeltaBpm(detectorInput),
    }),
    ai_insight: null,
  };

  summary.ai_insight = await generateDailyInsight(summary);

  return summary;
}
