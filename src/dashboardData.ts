import { DateTime } from "luxon";
import { getPendingPairings } from "./pairApi.js";
import { activeContext, upcomingContext } from "./history/context.js";
import { appConfig } from "./config.js";
import { isAiConfigured, getCachedDailyInsight } from "./promptApi.js";
import { getMetricSeries } from "./history/store.js";
import { buildDetectorInput, describeFindingsCoverage, runDetectors } from "./detect/index.js";
import { buildWeekReview } from "./detect/week.js";
import { nextRace } from "./detect/countdown.js";
import { median } from "./detect/baseline.js";
import { getProfile, stateFor, type MetricState, type TrainBudProfile } from "./profile.js";
import {
  budgetState,
  dailyAiSpend,
  featureCounts,
  monthToDateSpend,
  type AiSpend,
  type BudgetState,
  type DailySpend,
  type FeatureCount,
} from "./usage.js";
import { densify, type DumbbellRow, type SeriesPoint } from "./dashboardCharts.js";
import type { MetricKind } from "./history/schema.js";

// SECTION: Dashboard data
//
// Everything the dashboard draws, assembled from local SQLite and nothing else.
//
// That is a deliberate constraint, not a shortcut. The old page needed no data
// beyond a pairing list, so nobody had to decide; a training dashboard could
// easily have reached for the same six Garmin calls the watch makes, and the
// page would then take as long to paint as Connect takes to answer, fail when
// the session expires, and spend rate limit on every refresh. Every number
// below is already in the history store, which is the whole reason the memory
// layer exists.
//
// The one number that is NOT here is the recovery score, because Garmin
// computes it and never stores it. Rather than block the page on one call, the
// dashboard shows what this machine actually knows -- which is also the half
// Connect itself cannot show the user, since it does not compare anything to
// their own baseline.

const TREND_DAYS = 30;

export interface DashboardContextRow {
  id: number;
  kind: string;
  text: string;
  effective_from: string;
  effective_to: string | null;
}

export interface DashboardTile {
  key: string;
  label: string;
  value: string;
  /** The comparison that makes the value mean something, or null. */
  note: string | null;
  state: MetricState;
}

export interface DashboardTrend {
  points: SeriesPoint[];
  /** This person's own median over the window, for the reference line. */
  baseline: number | null;
  unit: string;
}

export interface DashboardWeek {
  ready: boolean;
  headline: string;
  rows: DumbbellRow[];
  forecastRatio: number | null;
  forecastVerdict: string;
  sleepDebtHours: number | null;
}

export interface DashboardFinding {
  severity: string;
  headline: string;
  detail: string;
}

export interface DashboardStatus {
  pending: { code: string; expires_in: number }[];
  ai_configured: boolean;
  insight: string | null;
  public_url: string;
  context: DashboardContextRow[];
}

export interface DashboardData extends DashboardStatus {
  profile: TrainBudProfile;
  tiles: DashboardTile[];
  findings: DashboardFinding[];
  /** The one sentence that explains an empty findings list. Null when it is genuinely empty. */
  coverageNote: string | null;
  coverageDays: number;
  coverageThrough: string | null;
  week: DashboardWeek;
  trends: { restingHr: DashboardTrend; sleep: DashboardTrend; stress: DashboardTrend };
  race: { text: string; daysAway: number; phase: string } | null;
  usage: {
    month: AiSpend;
    budget: BudgetState;
    daily: DailySpend[];
    features: FeatureCount[];
  };
}

function seriesFor(kind: MetricKind, days: number, transform?: (value: number) => number): DashboardTrend {
  const today = DateTime.local();
  const start = today.minus({ days: days - 1 }).toISODate() ?? "";
  const end = today.toISODate() ?? "";

  const raw = getMetricSeries(kind, start, end).map((point) => ({
    date: point.date,
    value: transform ? transform(point.value) : point.value,
  }));

  const values = raw.map((point) => point.value);
  return {
    points: densify(raw, days, today),
    // A median, not a mean: one unrecorded-looking outlier should not move the
    // line the user is being compared against.
    baseline: median(values),
    unit: "",
  };
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** The newest measured value in a densified series, or null. */
function latest(points: SeriesPoint[]): number | null {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const value = points[i]?.value;
    if (value !== null && value !== undefined) {
      return value;
    }
  }
  return null;
}

/**
 * The four tiles.
 *
 * Every one of them carries a comparison, because the number on its own is
 * what Connect already shows on the same wrist. "58 bpm" is a fact; "58 bpm,
 * 2 above your 30-day median" is the only version that tells the user
 * anything they could act on.
 */
function buildTiles(
  profile: TrainBudProfile,
  trends: { restingHr: DashboardTrend; sleep: DashboardTrend; stress: DashboardTrend },
  hrv: DashboardTrend
): DashboardTile[] {
  const tiles: DashboardTile[] = [];

  const sleep = latest(trends.sleep.points);
  tiles.push({
    key: "sleep",
    label: "Last night",
    value: sleep === null ? "—" : `${round(sleep)} h`,
    note:
      trends.sleep.baseline === null || sleep === null
        ? null
        : `${sleep >= trends.sleep.baseline ? "+" : ""}${round(sleep - trends.sleep.baseline)} h vs your usual`,
    state: stateFor("sleepHours", sleep, profile),
  });

  const rhr = latest(trends.restingHr.points);
  const rhrDelta =
    rhr === null || trends.restingHr.baseline === null ? null : round(rhr - trends.restingHr.baseline);
  tiles.push({
    key: "resting_hr",
    label: "Resting HR",
    value: rhr === null ? "—" : `${Math.round(rhr)} bpm`,
    note: rhrDelta === null ? null : `${rhrDelta >= 0 ? "+" : ""}${rhrDelta} vs your median`,
    // Graded on the distance from this person's own median, never the rate.
    state: stateFor("restingHrDelta", rhrDelta, profile),
  });

  const stress = latest(trends.stress.points);
  tiles.push({
    key: "stress",
    label: "Stress",
    value: stress === null ? "—" : String(Math.round(stress)),
    note:
      trends.stress.baseline === null || stress === null
        ? null
        : `median ${Math.round(trends.stress.baseline)}`,
    state: stateFor("stress", stress, profile),
  });

  const hrvNow = latest(hrv.points);
  tiles.push({
    key: "hrv",
    label: "HRV",
    value: hrvNow === null ? "—" : `${Math.round(hrvNow)} ms`,
    note: hrv.baseline === null || hrvNow === null ? null : `median ${Math.round(hrv.baseline)}`,
    // HRV has no user-facing band: it is meaningful only as a trend, and a
    // green or red HRV number would be a claim this product cannot support.
    state: "unknown",
  });

  return tiles;
}

export function getDashboardStatus(publicUrl?: string): DashboardStatus {
  const now = Math.floor(Date.now() / 1000);
  const today = DateTime.local().toISODate() ?? "";
  return {
    pending: getPendingPairings().map((token) => ({
      code: token.code,
      expires_in: Math.max(0, token.expires_at - now),
    })),
    ai_configured: isAiConfigured(),
    insight: getCachedDailyInsight(),
    public_url: publicUrl ?? appConfig.publicUrl,
    context: [...activeContext(today), ...upcomingContext(today)].map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      text: entry.text,
      effective_from: entry.effectiveFrom,
      effective_to: entry.effectiveTo,
    })),
  };
}

export function getDashboardData(publicUrl?: string): DashboardData {
  const status = getDashboardStatus(publicUrl);
  const profile = getProfile();
  const today = DateTime.local().toISODate() ?? "";

  const detection = runDetectors();
  const coverage = describeFindingsCoverage(detection.coverage);

  const trends = {
    restingHr: { ...seriesFor("resting_hr", TREND_DAYS), unit: " bpm" },
    sleep: { ...seriesFor("sleep_seconds", TREND_DAYS, (value) => value / 3600), unit: " h" },
    stress: { ...seriesFor("stress_avg", TREND_DAYS), unit: "" },
  };
  const hrv = seriesFor("hrv_overnight", TREND_DAYS);

  const review = buildWeekReview(buildDetectorInput());
  const rows: DumbbellRow[] = [
    { label: "Sessions", unit: "", current: review.sessions, previous: review.previousSessions },
    {
      label: "Moving",
      unit: " min",
      current: review.movingMinutes,
      previous: review.previousMovingMinutes,
    },
    ...review.metrics.map((metric) => ({
      label: metric.label,
      unit: metric.unit === "TRIMP" ? "" : metric.unit,
      current: metric.current,
      previous: metric.previous,
    })),
  ];

  const race = nextRace([...activeContext(today), ...upcomingContext(today)], today);

  return {
    ...status,
    profile,
    tiles: buildTiles(profile, trends, hrv),
    findings: detection.findings.map((finding) => ({
      severity: finding.severity,
      headline: finding.headline,
      detail: finding.detail,
    })),
    // An empty findings list means two opposite things, and the page has to say
    // which. "Nothing stands out" is a clean bill of health; "the record stops
    // three weeks ago" is a claim about days nobody measured.
    coverageNote:
      coverage.state === "ready"
        ? null
        : coverage.fix
          ? `${coverage.detail} ${coverage.fix}`
          : coverage.detail,
    coverageDays: detection.coverage.days,
    coverageThrough: detection.coverage.throughDate,
    week: {
      ready: review.ready,
      headline: review.headline,
      rows,
      forecastRatio: review.forecast.projectedRatio,
      forecastVerdict: review.forecast.verdict,
      sleepDebtHours: review.sleep.debtHours,
    },
    trends,
    race: race ? { text: race.text, daysAway: race.daysAway, phase: race.phase } : null,
    usage: {
      month: monthToDateSpend(),
      budget: budgetState(),
      daily: dailyAiSpend(TREND_DAYS),
      features: featureCounts(TREND_DAYS),
    },
  };
}
