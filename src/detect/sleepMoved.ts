import type { MetricKind } from "../history/schema.js";
import { buildBaseline, robustZ } from "./baseline.js";
import type { DetectorInput } from "./findings.js";

// SECTION: What moved last night
//
// A reply on r/GarminWatches: "knowing why my sleep score dropped, or went up,
// would make it easier to pinpoint causes." Garmin's score is a black box this
// app cannot open, so it does not pretend to attribute it. What it can do is lay
// last night's own parts -- the score, duration, deep, REM, awakenings, sleep
// stress, overnight HRV -- against this person's usual night and say which of
// them were unusual. Those are measurements, each against a baseline anyone can
// check, and a short deep phase on a stressful night is closer to a cause than
// "66, fair" ever was.
//
// Not a finding. Nothing here is raised as an alert; it is the detail behind
// the Sleep card and the sleep tool.

/** How unusual a part has to be before it is worth naming. */
const MOVER_Z = 1;

/** Relative change that counts when the history never varies and z is undefined. */
const FLAT_HISTORY_CHANGE = 0.3;

/** Nights of history each part is compared against. */
const BASELINE_NIGHTS = 28;

/** A night older than this is not "last night". */
const MAX_NIGHT_AGE_DAYS = 2;

const MAX_MOVERS = 3;

interface Part {
  kind: MetricKind;
  label: string;
  higherIsBetter: boolean;
  format: (value: number) => string;
  /** The compact form for a watch line, where "1h 24m" is two words too many. */
  compact: (value: number) => string;
}

function clock(seconds: number): string {
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function clockCompact(seconds: number): string {
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h${String(minutes).padStart(2, "0")}m`;
}

const whole = (value: number): string => String(Math.round(value));

const PARTS: Part[] = [
  { kind: "sleep_score", label: "Score", higherIsBetter: true, format: whole, compact: whole },
  { kind: "sleep_seconds", label: "Sleep", higherIsBetter: true, format: clock, compact: clockCompact },
  { kind: "sleep_deep_seconds", label: "Deep", higherIsBetter: true, format: clock, compact: clockCompact },
  { kind: "sleep_rem_seconds", label: "REM", higherIsBetter: true, format: clock, compact: clockCompact },
  { kind: "sleep_awake_count", label: "Awake", higherIsBetter: false, format: (v) => `${whole(v)}x`, compact: (v) => `${whole(v)}x` },
  { kind: "sleep_stress", label: "Stress", higherIsBetter: false, format: whole, compact: whole },
  { kind: "hrv_overnight", label: "HRV", higherIsBetter: true, format: (v) => `${whole(v)} ms`, compact: whole },
];

export interface SleepMover {
  kind: MetricKind;
  label: string;
  value: number;
  usual: number;
  /** Robust z against the user's own nights; signed, positive means higher. */
  z: number;
  /** Whether the move was in the direction that is good for this part. */
  better: boolean;
  /** "Deep 40m, down from your usual 1h 24m". */
  text: string;
  /** At most 18 characters: "Deep 40m (1h24m)". */
  short: string;
}

export interface SleepMoved {
  /** The night examined, or null when there is no recent night to examine. */
  date: string | null;
  movers: SleepMover[];
}

export function whatMovedLastNight(input: DetectorInput): SleepMoved {
  const today = input.now.startOf("day");
  const window = BASELINE_NIGHTS + MAX_NIGHT_AGE_DAYS + 2;

  const nights = input.series("sleep_seconds", window);
  const latest = nights.at(-1)?.date ?? null;
  const oldestAcceptable = today.minus({ days: MAX_NIGHT_AGE_DAYS }).toISODate() ?? "";
  if (latest === null || latest < oldestAcceptable) {
    return { date: null, movers: [] };
  }

  const movers: SleepMover[] = [];

  for (const part of PARTS) {
    const points = input.series(part.kind, window);
    const tonight = points.find((point) => point.date === latest);
    if (!tonight) {
      continue;
    }

    const history = points.filter((point) => point.date < latest).slice(-BASELINE_NIGHTS);
    const baseline = buildBaseline(history);
    if (!baseline) {
      continue;
    }

    let z = robustZ(tonight.value, baseline);
    if (z === null) {
      // A history that never varies has no spread to measure against. A
      // large relative change is still a change; a small one is not.
      const change = baseline.median === 0 ? 0 : (tonight.value - baseline.median) / baseline.median;
      if (Math.abs(change) < FLAT_HISTORY_CHANGE) {
        continue;
      }
      z = Math.sign(change) * (MOVER_Z + 0.5);
    }

    if (Math.abs(z) < MOVER_Z) {
      continue;
    }

    const higher = tonight.value > baseline.median;
    const better = higher === part.higherIsBetter;
    const value = part.format(tonight.value);
    const usual = part.format(baseline.median);

    movers.push({
      kind: part.kind,
      label: part.label,
      value: tonight.value,
      usual: baseline.median,
      z: Math.round(z * 10) / 10,
      better,
      text: `${part.label} ${value}, ${higher ? "up" : "down"} from your usual ${usual}`,
      short: `${part.label} ${part.compact(tonight.value)} (${part.compact(baseline.median)})`.slice(0, 18),
    });
  }

  movers.sort((left, right) => Math.abs(right.z) - Math.abs(left.z));

  return { date: latest, movers: movers.slice(0, MAX_MOVERS) };
}
