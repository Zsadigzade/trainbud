# Detectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a year of stored measurements into a short list of findings that
say something Garmin never says — joining metrics that live in separate silos,
against the user's own baseline rather than a population one.

**Architecture:** Pure TypeScript over `getMetricSeries` and
`getActivitiesBetween`. A robust baseline (median + MAD, not mean + standard
deviation, because a single 12-hour catch-up sleep should not move the bar) and
one function per signal, each returning a `Finding` or `null`. The model phrases
findings; it never decides them.

**Tech Stack:** TypeScript 6 (ESM, `.js` import extensions), luxon, `node --test`.

**Spec:** `docs/superpowers/specs/2026-08-20-memory-layer.md`

**Depends on:** `docs/superpowers/plans/2026-08-20-history-store.md` (complete).

## Global Constraints

- Node >= 20, ESM only, `.js` on relative imports.
- New test files must be listed in the `test` script in `package.json`.
- `npm run typecheck` and `npm run lint` pass before every commit.
- **Everything here is pure.** No network, no clock reads that are not passed
  in, no LLM. A detector that cannot be unit-tested is not shippable — this
  project's entire bug history is numbers being silently wrong, and a
  nondeterministic detector makes that unfalsifiable.
- **A finding states data, never cause.** "Resting HR 4 bpm above your 28-day
  baseline for 3 days" — never "you may be getting sick". The data cannot
  distinguish illness from a hot bedroom, and the distinction is what keeps this
  a training tool rather than a symptom checker.
- Advice attached to a finding covers **training load only**.
- Every detector returns `null` rather than guessing when it lacks data. Cold
  start must read as "still gathering", never as an empty card or a zero.

## Why median and MAD

Mean and standard deviation are both dragged by the outlier that a detector most
wants to notice. One 11-hour recovery sleep after a race lifts the mean and
inflates the deviation, so the bar rises and the next three short nights look
normal. Median and median-absolute-deviation ignore it. The robust z-score is
`0.6745 × (value − median) / MAD`, where `0.6745` makes MAD comparable to a
standard deviation for normally distributed data.

---

### Task 1: Robust baselines

**Files:**
- Create: `src/detect/baseline.ts`
- Create: `tests/detectBaseline.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `MetricPoint` (`src/history/store.ts`)
- Produces:
  - `interface Baseline { median: number; mad: number; count: number }`
  - `median(values: number[]): number | null`
  - `buildBaseline(points: MetricPoint[], minimumCount?: number): Baseline | null`
  - `robustZ(value: number, baseline: Baseline): number | null`
  - `meanOf(points: MetricPoint[]): number | null`

- [ ] **Step 1: Write the failing test** — `median` of an odd and an even set;
  `buildBaseline` returns `null` below `minimumCount` (default 14); MAD of a
  constant series is `0` and `robustZ` then returns `null` rather than
  `Infinity`; `robustZ` is positive above the median and negative below; one
  extreme outlier moves the median by less than it moves a mean over the same
  series (the property the whole file exists for).

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Write `src/detect/baseline.ts`.**

- [ ] **Step 4: Verify, commit** — `feat: robust baselines for detection`

---

### Task 2: TRIMP, the training load this project computes for itself

**Files:**
- Create: `src/detect/trimp.ts`
- Create: `tests/detectTrimp.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `StoredActivity` (`src/history/store.ts`)
- Produces:
  - `interface HrProfile { restingHr: number; maxHr: number }`
  - `estimateHrProfile(restingPoints: MetricPoint[], maxPoints: MetricPoint[]): HrProfile | null`
  - `trimpFor(activity: StoredActivity, profile: HrProfile): number | null`
  - `dailyTrimp(activities: StoredActivity[], profile: HrProfile): Map<string, number>`

**The formula and its assumption:**

```
HRr   = (avgHr - restingHr) / (maxHr - restingHr)     clamped to [0, 1]
TRIMP = minutes × HRr × 0.64 × e^(1.92 × HRr)
```

`IActivity` carries no training load at all — no `activityTrainingLoad`, no
training effect, no zone time — so Garmin's own number is not available from the
payload this project fetches, and it is absent for many activity types even
where it is. TRIMP needs only duration and average HR, which every activity has.

`maxHr` is estimated as the highest daily `max_hr` ever recorded, which is an
observed maximum rather than a true one. It is the best available without asking
the user their age, and it is honest: `estimateHrProfile` returns `null` when
there is nothing to estimate from, and an activity with no average HR returns
`null` rather than a zero that would quietly deflate a load sum.

- [ ] **Step 1: Write the failing test** — a session at resting HR scores ~0; a
  longer session at the same intensity scores proportionally more; a harder
  session scores more than an easier one of equal length; an activity with a
  null `avgHr` or a null duration returns `null`; an `avgHr` above `maxHr`
  clamps rather than exploding; `estimateHrProfile` returns `null` on empty
  input and picks the lowest plausible resting and highest observed max;
  `dailyTrimp` sums two sessions on the same date into one entry.

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Write `src/detect/trimp.ts`.**

- [ ] **Step 4: Verify, commit** — `feat: TRIMP training load computed from duration and heart rate`

---

### Task 3: The findings type and the three metric detectors

**Files:**
- Create: `src/detect/findings.ts` (types only)
- Create: `src/detect/detectors.ts`
- Create: `tests/detectors.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `type FindingKind = 'rhr_elevated' | 'sleep_debt' | 'hrv_trend_break' | 'load_ratio_high' | 'load_ratio_low'`
  - `type FindingSeverity = 'info' | 'notice' | 'warn'`
  - `interface Finding { kind: FindingKind; severity: FindingSeverity; date: string; headline: string; detail: string; values: Record<string, number> }`
  - `interface DetectorInput { now: DateTime; series: (kind: MetricKind, days: number) => MetricPoint[]; activities: (days: number) => StoredActivity[] }`
  - `detectRestingHrElevation(input: DetectorInput): Finding | null`
  - `detectSleepDebt(input: DetectorInput): Finding | null`
  - `detectHrvTrendBreak(input: DetectorInput): Finding | null`

**Thresholds, and why each one:**

| Detector | Fires when | Reasoning |
|---|---|---|
| `rhr_elevated` | the last **3** consecutive days are each ≥ 2 robust-z **and** ≥ 3 bpm above the 28-day median | one high morning is noise — a late meal, a warm room. Three in a row is a pattern. The absolute floor stops a very stable sleeper being flagged over a 1 bpm move that happens to be statistically large. |
| `sleep_debt` | the 7-day deficit against the personal median is ≥ **3 hours** | measured against your own median, not against 8 hours, so a genuine short sleeper is not permanently in debt. |
| `hrv_trend_break` | the 3-day mean is ≤ **−2** robust-z against the 28-day median | HRV is noisy night to night; a 3-day mean is the shortest window that is not mostly noise. Reads measured `hrv_overnight` — never the composite recovery score, which is hand-weighted, self-invented, and already counts sleep and stress that have their own detectors. |

- [ ] **Step 1: Write the failing test** — build a `DetectorInput` from in-memory
  arrays (no DB). For each detector: it fires on the designed case with the
  expected `values`; it stays silent one notch below the threshold; it returns
  `null` on insufficient history; a 2-day run of high RHR does **not** fire while
  a 3-day run does; sleep debt is measured against the personal median, so a
  consistent 6-hour sleeper with 6-hour nights has no debt. Assert on `values`
  and `kind`, and assert the `headline` contains the number and the baseline —
  not that it contains any particular adjective.

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Write `src/detect/findings.ts` and `src/detect/detectors.ts`.**
  Headlines state the measurement and the baseline it is compared against.
  Nothing in this file speculates about cause.

- [ ] **Step 4: Verify, commit** — `feat: resting HR, sleep debt and HRV detectors`

---

### Task 4: The load ratio detector

**Files:**
- Modify: `src/detect/detectors.ts`, `tests/detectors.test.ts`

**Interfaces:**
- Produces: `detectLoadRatio(input: DetectorInput): Finding | null`

**Definition:** acute (7-day TRIMP sum) divided by chronic (28-day TRIMP sum ÷ 4,
so both are weekly figures). Fires **high** above `1.5` and **low** below `0.8`.
Requires at least 21 of the 28 chronic days to be covered by the store, or the
chronic average is computed over a hole and every ratio looks alarming.

**Say the number is ours.** It will not match what Connect shows, because Connect
is not computing TRIMP. The detail line says so.

- [ ] **Step 1: Write the failing test** — a steady four weeks yields a ratio
  near `1.0` and no finding; a spike week fires `load_ratio_high` with the ratio
  in `values`; two near-empty weeks after a full block fire `load_ratio_low`; a
  store holding only 10 days returns `null` rather than a ratio computed over a
  hole; an activity with no HR contributes nothing rather than a zero.

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Write `detectLoadRatio`.**

- [ ] **Step 4: Verify, commit** — `feat: acute:chronic load ratio detector`

---

### Task 5: Running them all, and the cold start

**Files:**
- Create: `src/detect/index.ts`
- Create: `tests/detectRun.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `interface DetectionResult { findings: Finding[]; coverage: { days: number; ready: boolean }; }`
  - `buildDetectorInput(now?: DateTime): DetectorInput` — the only function here that touches the store
  - `runDetectors(input?: DetectorInput): DetectionResult`

**Cold start is a first-class case.** With no history every detector returns
`null`, and the honest report is "still gathering data", not an empty card.
`coverage.ready` is false until the store holds at least 14 days, and every
surface reads that flag rather than inferring from an empty array.

Findings sort by severity (`warn`, `notice`, `info`), then by kind, so the order
is stable — the watch shows the first two and a stable order is what stops them
shuffling between syncs.

- [ ] **Step 1: Write the failing test** — an empty input yields no findings and
  `ready: false`; an input with 30 days of unremarkable data yields no findings
  and `ready: true` (the distinction the surfaces depend on); several
  simultaneous findings come back severity-sorted; the sort is stable across
  repeated calls.

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Write `src/detect/index.ts`.**

- [ ] **Step 4: Verify, commit** — `feat: run every detector, and report the cold start honestly`

---

## What this unblocks

Plan 4's surfaces: the glance flag, card 0 on the watch, the daily insight
regenerated from findings rather than from today's snapshot, and the Ask menu
whose five prompts are generated from what actually fired.
