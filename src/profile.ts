import { z } from "zod";
import { getSetting, setSetting } from "./appDb.js";
// The Ask menu's own limits. Imported rather than restated: a second copy of
// "five" and "32" here would drift from the file that decides what the watch
// draws, and the drift would look like a working setting.
import { PROMPT_MAX_LENGTH, PROMPT_SLOTS } from "./promptLimits.js";
import { DEFAULT_DETECTOR_RULES } from "./detect/findings.js";

// SECTION: Profile — everything TrainBud knows about you that Garmin does not
//
// Garmin measures you. It has no idea what you are training for, which units
// you think in, which screens you care about, or what "a bad night" means for
// your body rather than for the population. All of that lives here, in one
// row of app.db, and every surface reads it from this module.
//
// Two rules hold this together.
//
// A corrupt or partial row must never take the server down. `getProfile` is on
// the path of every watch fetch, every dashboard paint and several CLI
// commands; a JSON parse error in a settings row is not a reason for any of
// them to fail. Anything unreadable falls back to its default, field by field,
// and the readable neighbours survive.
//
// Thresholds are resolved HERE and nowhere else. The watch used to carry its
// own copies of these bands in Monkey C -- `recoveryColor`, `sleepColor`,
// `stressColor`, `heartRateColor` -- which meant the number on the wrist and
// the number in the browser could disagree about whether the same score was
// good, and personalising the bands would have made that certain. The server
// sends a resolved state; the watch maps state to colour and knows nothing
// about where the line falls.

/** The cards the carousel can show, in shipping order. */
export const CARD_IDS = [
  "today",
  "ask",
  "insight",
  "week",
  "overview",
  "recovery",
  "sleep",
  "activity",
  "stress",
] as const;

export type CardId = (typeof CARD_IDS)[number];

/** What a metric's value says about you right now. */
export type MetricState = "good" | "caution" | "hard" | "unknown";

/**
 * Metrics that can be graded, and which direction is better.
 *
 * `restingHrDelta` is deliberately a delta rather than a rate. 58 bpm is
 * unremarkable for one person and a warning for another; the distance from
 * that person's own median is the only version of this number that means
 * anything, and the detectors already compute the median.
 */
export const GRADED_METRICS = {
  recovery: "higher",
  sleepHours: "higher",
  stress: "lower",
  restingHrDelta: "lower",
} as const;

export type GradedMetric = keyof typeof GRADED_METRICS;

const bandSchema = z.object({
  good: z.number(),
  caution: z.number(),
});

const thresholdsSchema = z.object({
  recovery: bandSchema,
  sleepHours: bandSchema,
  stress: bandSchema,
  restingHrDelta: bandSchema,
});

/**
 * Where each detector draws its line.
 *
 * Bounded so that no setting makes every day a finding or no day ever one: a
 * resting-HR floor of 0 bpm would fire on noise, a load ceiling of 1.0 would
 * fire every week, and a window of 30 days would never fill. The bounds are
 * wide enough to be a real choice and narrow enough that the app still means
 * something afterwards.
 */
const detectorRulesSchema = z.object({
  restingHr: z.object({
    days: z.number().int().min(2).max(7),
    minZ: z.number().min(0.5).max(5),
    minBpm: z.number().min(1).max(20),
  }),
  sleepDebt: z.object({ hours: z.number().min(0.5).max(20) }),
  hrv: z.object({ dropZ: z.number().min(0.5).max(5) }),
  load: z.object({
    high: z.number().min(1.05).max(5),
    low: z.number().min(0.1).max(0.95),
  }),
  strain: z.object({
    enabled: z.boolean(),
    days: z.number().int().min(1).max(7),
    z: z.number().min(0.5).max(5),
  }),
});

/**
 * There is deliberately no `timezone` here.
 *
 * One sat in this schema from the beginning -- validated, defaulted, persisted,
 * and read by nothing, in any surface, ever. Removing it rather than wiring it
 * up is the decision, because it is not a missing feature: every day boundary in
 * this product comes from `DateTime.local()`, and that is what makes the day
 * asked of Connect the day the user actually lived. Reading one of those local
 * midnights in another zone is precisely the bug documented on `toGarminDate` in
 * `garmin/rawApi.ts` -- at UTC+4 it filed stress and VO2 max under the previous
 * day, feeding a recovery score built from a day that never happened.
 *
 * A user-set zone would reopen that from the other end: `today` would move while
 * the date keys the history is stored under would not, so "today" would miss
 * them. Anyone adding one has to move the whole pipeline together, not a field.
 */
const profileSchema = z.object({
  displayName: z.string().max(60).nullable(),
  units: z.enum(["metric", "imperial"]),
  primarySport: z
    .enum(["running", "cycling", "swimming", "strength", "mixed"])
    .nullable(),
  weeklyGoal: z.object({
    sessions: z.number().int().min(0).max(30).nullable(),
    minutes: z.number().int().min(0).max(10_000).nullable(),
  }),
  thresholds: thresholdsSchema,
  detectorRules: detectorRulesSchema,
  cards: z.object({
    order: z.array(z.string()),
    hidden: z.array(z.string()),
  }),
  ai: z.object({
    tone: z.enum(["direct", "supportive", "technical"]),
    length: z.enum(["short", "normal", "detailed"]),
    // Constrained to models this build can price. An unpriced model would
    // record its tokens with an unknown cost and quietly make the monthly cap
    // unenforceable, so the choice is limited to what `usage.ts` has rates for.
    model: z.enum(["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"]),
    // The Ask menu the user writes for themselves. Bounded by what the menu
    // can show rather than by a round number: five slots, and a width the
    // watch can draw without clipping. It shipped in 0.5.0 as `max(120)` and
    // `max(8)` with nothing reading it, which stored questions that could not
    // have appeared and questions that would have been cut off mid-word.
    customPrompts: z
      .array(z.string().trim().min(1).max(PROMPT_MAX_LENGTH))
      .max(PROMPT_SLOTS),
  }),
  budget: z.object({
    monthlyUsd: z.number().min(0).max(10_000).nullable(),
  }),
  analytics: z.object({
    enabled: z.boolean(),
  }),
});

export type TrainBudProfile = z.infer<typeof profileSchema>;

/**
 * Bands chosen to match what the watch already drew, so nobody's colours move
 * on upgrade. They are a starting point, not a claim about physiology -- the
 * whole reason they are editable is that the population defaults are wrong for
 * most individuals.
 */
export const DEFAULT_PROFILE: TrainBudProfile = {
  displayName: null,
  units: "metric",
  primarySport: null,
  weeklyGoal: { sessions: null, minutes: null },
  thresholds: {
    recovery: { good: 70, caution: 50 },
    sleepHours: { good: 7.5, caution: 6.5 },
    stress: { good: 25, caution: 50 },
    restingHrDelta: { good: 2, caution: 5 },
  },
  detectorRules: DEFAULT_DETECTOR_RULES,
  cards: { order: [...CARD_IDS], hidden: [] },
  // Haiku by default: these answers are two or three sentences read on a
  // watch, and the user pays for every one of them out of their own key.
  ai: { tone: "direct", length: "short", model: "claude-haiku-4-5", customPrompts: [] },
  budget: { monthlyUsd: null },
  analytics: { enabled: true },
};

const PROFILE_KEY = "profile";

let cached: TrainBudProfile | null = null;

/** Tests reach into the cache; nothing else should. */
export function __resetProfileCacheForTests(): void {
  cached = null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge a stored value over a default, field by field, keeping whatever is
 * readable.
 *
 * A whole-object `safeParse` is the wrong tool for reading storage: one bad
 * enum in one nested object discards the twelve fields around it that were
 * perfectly good. Writes are validated strictly (see `updateProfile`); reads
 * salvage.
 */
function salvage<T>(stored: unknown, fallback: T, schema: z.ZodType<T>): T {
  const direct = schema.safeParse(stored);
  if (direct.success) {
    return direct.data;
  }
  if (!isRecord(stored) || !isRecord(fallback)) {
    return fallback;
  }

  const merged: Record<string, unknown> = { ...fallback };
  for (const [key, value] of Object.entries(stored)) {
    if (!(key in (fallback as Record<string, unknown>))) {
      continue;
    }
    const fallbackValue = (fallback as Record<string, unknown>)[key];
    const candidate = { ...merged, [key]: value };
    if (schema.safeParse(candidate).success) {
      merged[key] = value;
      continue;
    }
    // The field itself is bad, but it may be an object with good parts.
    if (isRecord(value) && isRecord(fallbackValue)) {
      const nested: Record<string, unknown> = { ...fallbackValue };
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        if (!(nestedKey in fallbackValue)) {
          continue;
        }
        const nestedCandidate = { ...merged, [key]: { ...nested, [nestedKey]: nestedValue } };
        if (schema.safeParse(nestedCandidate).success) {
          nested[nestedKey] = nestedValue;
        }
      }
      merged[key] = nested;
    }
  }

  const result = schema.safeParse(merged);
  return result.success ? result.data : fallback;
}

export function getProfile(): TrainBudProfile {
  if (cached) {
    return cached;
  }

  const raw = getSetting(PROFILE_KEY);
  if (raw === null) {
    cached = DEFAULT_PROFILE;
    return cached;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A row that is not JSON is wreckage, not configuration. Defaults are a
    // working server; a throw here would take down every watch fetch.
    cached = DEFAULT_PROFILE;
    return cached;
  }

  cached = normalizeCards(salvage(parsed, DEFAULT_PROFILE, profileSchema));
  return cached;
}

/**
 * Put the card list back into a state the carousel can render.
 *
 * Unknown ids are dropped and missing ids are appended, which is what stops an
 * older client from deleting a card it has never heard of simply by leaving it
 * out of the order it sends.
 */
function normalizeCards(profile: TrainBudProfile): TrainBudProfile {
  const known = new Set<string>(CARD_IDS);
  const seen = new Set<string>();
  const order: string[] = [];

  for (const id of profile.cards.order) {
    if (known.has(id) && !seen.has(id)) {
      order.push(id);
      seen.add(id);
    }
  }
  for (const id of CARD_IDS) {
    if (!seen.has(id)) {
      order.push(id);
    }
  }

  const hidden = profile.cards.hidden.filter((id) => known.has(id));
  return { ...profile, cards: { order, hidden } };
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K];
};

function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  if (!isRecord(base) || !isRecord(patch)) {
    return (patch as T) ?? base;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    const current = out[key];
    if (isRecord(value) && isRecord(current)) {
      out[key] = deepMerge(current, value as DeepPartial<typeof current>);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

export class ProfileValidationError extends Error {}

/**
 * Apply a partial change.
 *
 * Unlike reads, writes are strict: a caller sending a unit we do not know is a
 * bug in that caller, and storing it would mean every later read has to
 * salvage around it. The error names the field so the dashboard can say which
 * input was refused.
 */
export function updateProfile(patch: DeepPartial<TrainBudProfile>): TrainBudProfile {
  const merged = deepMerge(getProfile(), patch);

  const parsed = profileSchema.safeParse(merged);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "profile";
    throw new ProfileValidationError(`${path}: ${issue?.message ?? "invalid value"}`);
  }

  const next = parsed.data;

  for (const id of next.cards.order) {
    if (!(CARD_IDS as readonly string[]).includes(id)) {
      throw new ProfileValidationError(`cards.order: unknown card "${id}"`);
    }
  }
  for (const id of next.cards.hidden) {
    if (!(CARD_IDS as readonly string[]).includes(id)) {
      throw new ProfileValidationError(`cards.hidden: unknown card "${id}"`);
    }
  }
  if (next.cards.hidden.length >= CARD_IDS.length) {
    throw new ProfileValidationError("cards.hidden: at least one card must stay visible");
  }

  for (const [metric, direction] of Object.entries(GRADED_METRICS)) {
    const band = next.thresholds[metric as GradedMetric];
    const ordered = direction === "higher" ? band.good > band.caution : band.good < band.caution;
    if (!ordered) {
      throw new ProfileValidationError(
        direction === "higher"
          ? `thresholds.${metric}: good must be above caution`
          : `thresholds.${metric}: good must be below caution`
      );
    }
  }

  const normalized = normalizeCards(next);
  setSetting(PROFILE_KEY, JSON.stringify(normalized));
  cached = normalized;
  return normalized;
}

/** Card ids in the user's order, with hidden ones removed. */
export function visibleCards(profile: TrainBudProfile = getProfile()): string[] {
  const hidden = new Set(profile.cards.hidden);
  return profile.cards.order.filter((id) => !hidden.has(id));
}

/**
 * Grade one value against this user's bands.
 *
 * A missing value returns `unknown`, never `hard`. An unworn watch is not a
 * recovery score of zero, and colouring an absence red is how a UI invents a
 * measurement it was never given.
 */
export function stateFor(
  metric: GradedMetric,
  value: number | null | undefined,
  profile: TrainBudProfile = getProfile()
): MetricState {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "unknown";
  }

  const band = profile.thresholds[metric];
  const higherIsBetter = GRADED_METRICS[metric] === "higher";

  if (higherIsBetter) {
    if (value >= band.good) return "good";
    if (value >= band.caution) return "caution";
    return "hard";
  }

  if (value <= band.good) return "good";
  if (value <= band.caution) return "caution";
  return "hard";
}
