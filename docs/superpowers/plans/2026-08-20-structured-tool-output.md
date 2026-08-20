# Structured Tool Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every tool returns typed structured data alongside its rendered text, so
detectors, the history store and the watch read real values instead of
regex-scraping formatted prose.

**Architecture:** Split each tool into three parts — a fetcher (network, cached,
unchanged), a pure `build*Payload()` that shapes fetched rows into a typed
payload, and a pure `render*Text()` that produces the exact string the tool
returns today. The handler wires them and returns `{ type, text, data }`. `data`
is optional on `ToolResult` during migration and becomes required in Task 6, so
the compiler proves every tool was converted. MCP output stays byte-identical
because the renderers are the existing formatting code moved verbatim.

**Tech Stack:** TypeScript 6 (ESM, `.js` import extensions), `node --test`,
better-sqlite3, luxon.

**Spec:** `docs/superpowers/specs/2026-08-20-memory-layer.md`

## Global Constraints

- Node >= 20. ESM only — every relative import ends in `.js`.
- Tests run via `npm test`, which lists each test file explicitly in
  `package.json`. **A new test file not added to that list does not run.**
- `npm run typecheck` and `npm run lint` must pass before every commit.
- **MCP text output must not change.** The `text` field is a public interface
  consumed by Claude Desktop and Cursor. Renderers are existing code moved, not
  rewritten. Em dashes in existing strings stay em dashes.
- `build*Payload` and `render*Text` are pure — no network, no cache, no clock.
- Existing test count is 92 and must not go down.

---

### Task 1: `ToolResult` and the sleep tool as the reference conversion

**Files:**
- Modify: `src/garmin/types.ts` (add `ToolResult<T>` under `ToolTextResult`)
- Create: `src/tools/payloads.ts`
- Modify: `src/tools/sleep.ts:57-105`
- Create: `tests/toolPayloads.test.ts`
- Modify: `package.json` (`test` script)

**Interfaces:**
- Consumes: `SleepNightSummary` (`src/garmin/types.ts:22-33`)
- Produces:
  - `ToolResult<T> extends ToolTextResult { data?: T }`
  - `SleepPayload { requestedNights: number; recordedNights: number; averageScore: number | null; nights: SleepNightSummary[] }`
  - `buildSleepPayload(nights: SleepNightSummary[], requestedNights: number): SleepPayload`
  - `renderSleepText(payload: SleepPayload): string`

- [ ] **Step 1: Write the failing test** — `tests/toolPayloads.test.ts`, with a
  `night()` fixture factory and five cases: nights pass through untouched
  (`avgOvernightHrv` survives); the average counts only scored nights
  (`[80, null, 60]` → `70`); a null average when nothing scored; the empty
  render equals `"No sleep data found for the last 5 nights."`; the populated
  render matches `/^Sleep summary for last 1 recorded nights:$/m`,
  `/^Average sleep score: 78$/m`, `/^ {2}Total sleep: 6h 18m$/m`.

- [ ] **Step 2: Run it, confirm it fails** — `node --import tsx --test tests/toolPayloads.test.ts`.
  Expected: FAIL, `buildSleepPayload` is not exported.

- [ ] **Step 3: Add `ToolResult` to `src/garmin/types.ts`**

```typescript
/**
 * Tools return rendered text for MCP clients and the same information as typed
 * data for everything else. `data` is optional only while the nine tools are
 * converted one at a time; Task 6 makes it required so the compiler proves none
 * was missed.
 */
export interface ToolResult<T> extends ToolTextResult {
  data?: T;
}
```

- [ ] **Step 4: Create `src/tools/payloads.ts`** with a section comment and
  `SleepPayload`. One interface per tool lives here; nothing in this file is
  derived from formatted text.

- [ ] **Step 5: Convert `src/tools/sleep.ts`** — `formatSleepNight` and
  `fetchSleepNights` unchanged. Extract the averaging into `buildSleepPayload`,
  move the empty-case string and the header/average/nights join into
  `renderSleepText`, and reduce the handler to fetch → build → return
  `{ type, text, data }` with signature `Promise<ToolResult<SleepPayload>>`.

- [ ] **Step 6: Register the test file** — append ` tests/toolPayloads.test.ts`
  to the `test` script in `package.json`.

- [ ] **Step 7: Verify** — `npm test && npm run typecheck && npm run lint`.
  Expected: PASS, 97 tests.

- [ ] **Step 8: Commit**

```bash
git add src/garmin/types.ts src/tools/payloads.ts src/tools/sleep.ts tests/toolPayloads.test.ts package.json
git commit -m "refactor: tools return structured data, starting with sleep"
```

---

### Task 2: Activities

**Files:**
- Modify: `src/tools/payloads.ts`, `src/tools/activities.ts:88-145`, `tests/toolPayloads.test.ts`

**Interfaces:**
- Consumes: `ActivitySummary` (`src/garmin/types.ts:5-21`), `ToolResult`
- Produces:
  - `LatestActivityPayload { activity: ActivitySummary | null }`
  - `ActivitiesRangePayload { startDate: string; endDate: string; truncated: boolean; activities: ActivitySummary[] }`
  - `buildActivitiesRangePayload(activities, startDate, endDate, truncated): ActivitiesRangePayload`
  - `renderLatestActivityText(payload: LatestActivityPayload): string`
  - `renderActivitiesRangeText(payload: ActivitiesRangePayload): string`

- [ ] **Step 1: Write the failing tests** — an `activity()` fixture factory plus:
  empty latest renders `"No activities found in your Garmin Connect account."`;
  a populated latest renders `/^Activity: Morning Run$/m`; the range payload
  carries both dates and the truncation flag; the empty range renders
  `"No activities found between 2026-08-01 and 2026-08-19."`; the truncation
  note appears only when `truncated` is true.

- [ ] **Step 2: Run, confirm failure.**

- [ ] **Step 3: Add both interfaces to `payloads.ts`**, merging the
  `ActivitySummary` type import into the existing `../garmin/types.js` import
  rather than adding a second one.

- [ ] **Step 4: Convert `activities.ts`** — `mapActivity`,
  `formatActivitySummary`, `fetchActivitiesPage`, `fetchActivitiesPool` and
  `getActivitiesPool` unchanged. `renderLatestActivityText` returns
  `formatActivitySummary(payload.activity)` or the empty string.
  `renderActivitiesRangeText` holds the numbered-line map, the
  `parseActivityLocalDateTime` date fallback and the truncation warning —
  **the warning's em dash is copied verbatim.**

- [ ] **Step 5: Verify** — `npm test && npm run typecheck`.

- [ ] **Step 6: Commit** — `refactor: activity tools return structured data`

---

### Task 3: The three trend tools — heart rate, stress, VO2 max

**Files:**
- Modify: `src/tools/payloads.ts`, `src/tools/heartRate.ts:56-95`,
  `src/tools/stress.ts:31-72`, `src/tools/vo2Max.ts:27-76`,
  `tests/toolPayloads.test.ts`

**Interfaces:**
- Consumes: `HeartRateDaySummary` (`src/garmin/types.ts:35-41`),
  `DailyStressSummary` and `Vo2MaxEntry` (`src/garmin/rawApi.ts`)
- Produces:
  - `HeartRatePayload { requestedDays; recordedDays; currentResting: number | null; averageResting: number | null; trend: string; days: HeartRateDaySummary[] }`
  - `StressPayload { requestedDays; recordedDays; averageStress: number | null; trend: string; days: DailyStressSummary[] }`
  - `Vo2MaxPayload { requestedDays; recordedDays; current: number | null; oldest: number | null; trend: string; entries: Vo2MaxEntry[] }`
  - `buildHeartRatePayload` / `renderHeartRateText`,
    `buildStressPayload` / `renderStressText`,
    `buildVo2MaxPayload` / `renderVo2MaxText`

**Why grouped:** all three are the same shape — fetch a per-day array, compute one
trend, print a header plus recent lines. Split, they would be three identical
diffs for a reviewer to approve.

- [ ] **Step 1: Write the failing tests** — heart rate: current resting comes
  from the newest day, average of `[52, 50]` is `51`; the empty case renders
  `"No heart rate data found for the last 30 days."`; a day with
  `restingHeartRate: null` yields `currentResting: null`,
  `averageResting: null` and renders `Current resting HR: n/a bpm`. Stress:
  `[34, null, 30]` averages to `32`; empty renders
  `"No stress data found for the last 7 days."`. VO2 max: current and oldest
  across the range; empty renders `"No VO2 max data found for the last 30 days."`.

- [ ] **Step 2: Run, confirm failure.**

- [ ] **Step 3: Add the three interfaces to `payloads.ts`.**

- [ ] **Step 4: Convert `heartRate.ts`.** One behaviour fix travels with the
  move: the old code called `Math.round(average([]))` and printed `NaN` when no
  day recorded a resting HR. `averageResting` is `null` in that case and renders
  `n/a`. `recordedDays` is the count of returned days, matching the existing
  `Heart rate trends over N days:` header.

- [ ] **Step 5: Convert `stress.ts`.** The `Trend:` line is conditional on more
  than one *measured* day — preserve that, it is `averages.length > 1` today.

- [ ] **Step 6: Convert `vo2Max.ts`.** Same: `Trend:` is conditional on more than
  one measured value, `Oldest in range:` on more than one entry.

- [ ] **Step 7: Verify** — `npm test && npm run typecheck && npm run lint`.

- [ ] **Step 8: Commit** — `refactor: trend tools return structured data`

---

### Task 4: Recovery and body composition

**Files:**
- Modify: `src/tools/payloads.ts`, `src/tools/recovery.ts:198-260`,
  `src/tools/bodyComposition.ts:46-137`, `tests/toolPayloads.test.ts`

**Interfaces:**
- Consumes: `RecoveryStatusResult` (`src/garmin/types.ts:56-68`),
  `BodyCompositionEntry` (`src/garmin/types.ts:43-49`)
- Produces:
  - `RecoveryPayload { date: string; recovery: RecoveryStatusResult }`
  - `BodyCompositionPayload { requestedDays; recordedDays; current: BodyCompositionEntry | null; baseline: BodyCompositionEntry | null; weightDeltaKg: number | null; bodyFatDeltaPercent: number | null; weightTrend: string; bodyFatTrend: string; muscleTrend: string; entries: BodyCompositionEntry[] }`
  - `renderRecoveryText(payload: RecoveryPayload): string`
  - `buildBodyCompositionPayload(entries, requestedDays): BodyCompositionPayload`
  - `renderBodyCompositionText(payload): string`

**Note:** recovery needs no builder — `buildRecoveryStatus` already returns a
structured `RecoveryStatusResult`. Only the renderer splits out, and the date is
passed in rather than read from `new Date()` inside it, which is what makes the
renderer pure.

- [ ] **Step 1: Write the failing tests** — recovery renders
  `/^Recovery score: 91\/100 \(recovered\)$/m`, `/^- HRV: 95$/m` and
  `/^Date: 2026-08-19$/m`. Body composition: deltas between newest and oldest
  (`74.2 - 76.0` → `-1.8`); a null delta when either side is missing; the empty
  case renders `"No body composition data found for the last 30 days."`.

- [ ] **Step 2: Run, confirm failure.**

- [ ] **Step 3: Add both interfaces to `payloads.ts`.**

- [ ] **Step 4: Split `renderRecoveryText` out of the recovery handler**; the
  handler builds `{ date: formatIsoDate(new Date()), recovery }` and returns
  `Promise<ToolResult<RecoveryPayload>>`.

- [ ] **Step 5: Convert `bodyComposition.ts`** — a local `delta()` helper
  replaces the four-way null checks written inline today, and a local
  `values(key)` helper replaces the three repeated map/filter chains feeding
  `calculateTrend`. `formatIsoDate` stays imported; `fetchBodyComposition` still
  uses it.

- [ ] **Step 6: Verify** — `npm test && npm run typecheck && npm run lint`.

- [ ] **Step 7: Commit** — `refactor: recovery and body composition return structured data`

---

### Task 5: Training insights, the composing tool

**Files:**
- Modify: `src/tools/payloads.ts`, `src/tools/trainingInsights.ts:10-54`,
  `tests/toolPayloads.test.ts`

**Interfaces:**
- Consumes: `SleepPayload`, `RecoveryPayload`, `StressPayload`, `ActivitySummary`
- Produces:
  - `TrainingInsightsPayload { startDate: string; endDate: string; latest: ActivitySummary | null; activities: ActivitySummary[]; sleep: SleepPayload | null; recovery: RecoveryPayload | null; stress: StressPayload | null }`
  - `renderTrainingInsightsText(payload, sleepText, recoveryText, stressText): string`

**Why the renderer takes sub-texts:** the current output embeds the other tools'
rendered text verbatim. Re-deriving it here would call three renderers from a
fourth; passing them in keeps the output identical and the function pure.

- [ ] **Step 1: Write the failing test** — with all three sections passed as
  sentinel strings, assert `/^Period: 2026-08-12 to 2026-08-19$/m`,
  `/^## Latest activity\nNo activities found\.$/m`, the empty-range line, and
  `/^## Sleep\nSLEEP-SECTION$/m` for each section.

- [ ] **Step 2: Run, confirm failure.**

- [ ] **Step 3: Add `TrainingInsightsPayload` to `payloads.ts`.**

- [ ] **Step 4: Convert `trainingInsights.ts`** — the handler awaits the three
  sub-tools as it does now and reads `.data` off each for the payload while
  passing `.text` to the renderer. `DateTime.toISODate()` returns
  `string | null`; coalesce to `""` at the call site as the current code does
  when building the range.

- [ ] **Step 5: Verify** — `npm test && npm run typecheck && npm run lint`.

- [ ] **Step 6: Commit** — `refactor: training insights returns structured data`

---

### Task 6: Delete the regex parser — `watchApi.ts` reads typed data

**Files:**
- Modify: `src/garmin/types.ts` (make `data` required)
- Modify: `src/tools/types.ts:8-11` (handler return type)
- Modify: `src/tools/index.ts:35-60` (`executeTool` return type)
- Rewrite: `src/watchApi.ts:59-260` (delete eight parsers plus `safeExecuteTool`)
- Create: `tests/watchApi.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: every payload type from Tasks 1-5
- Produces:
  - `ToolResult<T> extends ToolTextResult { data: T }` — now required
  - `toWatchRecovery`, `toWatchSleep`, `toWatchActivity`, `toWatchStress`,
    `toWatchVo2Max`, `toWatchHeartRate` — pure mappers, exported for test
  - `WatchSummaryParts { recovery; sleep; activity; stress; vo2max; heartRate; updatedAt }`
  - `buildWatchSummaryFrom(parts: WatchSummaryParts): Omit<WatchSummary, "ai_insight">`

**Why this task is the point of the plan:** `src/watchApi.ts` reconstructs numbers
by matching regexes against prose — `Recovery score:\s*(null|\d+)\/100`, `(\d+)h`,
`resting \d+ bpm, max (\d+) bpm`. There is no test file for it. Every label
threshold and unit conversion in it is untested code sitting between the tools
and the watch.

- [ ] **Step 1: Write the failing test** — `tests/watchApi.test.ts` covering:
  recovery labels come from `status` (`recovered` → `Ready`, `fatigued` → `Rest`,
  `good` → `Light`), not from the score; sleep converts `22680` seconds to `6.3`
  hours with label `Good`; activity converts `5200` m to `5.2` km and `1920` s to
  `32` min and passes `startTimeLocal` through; every mapper returns `null` on an
  empty payload; the stress label thresholds hold at the boundaries
  (`25` → `Low`, `50` → `Medium`, `61` → `High`); `buildWatchSummaryFrom` fills
  the overview grid and leaves absent cards `null`.

- [ ] **Step 2: Run, confirm failure.**

- [ ] **Step 3: Make `data` required, tighten `ToolDefinition.handler` to
  `Promise<ToolResult<unknown>>`, and change `executeTool`'s return type to
  match.** Then run `npm run typecheck` **before touching `watchApi.ts`** — it
  must report zero errors. An error here means a tool from Tasks 1-5 was missed.
  That check is the reason `data` was optional until now.

- [ ] **Step 4: Replace `watchApi.ts:59-260` with the typed mappers.** The
  `Watch*` interfaces at the top of the file (lines 6-57) stay exactly as they
  are — the JSON contract with the watch does not change. `payloadOf<T>()`
  replaces `safeExecuteTool`, returning `result.data as T` or `null` on throw.

  **Behaviour change to expect and accept:** the old `parseRecovery` fell back to
  averaging component scores when the header read `null` — a workaround for the
  NaN bug fixed on 2026-08-19. The score is a real number now; the fallback is
  dead code and is not carried over.

- [ ] **Step 5: Register `tests/watchApi.test.ts` in `package.json` and verify** —
  `npm test && npm run typecheck && npm run lint`.

- [ ] **Step 6: Commit** — `refactor: watch summary reads typed payloads instead of parsing text`

---

### Task 7: Pin the MCP text output

**Files:**
- Create: `tests/toolTextContract.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: every `render*Text` from Tasks 1-5

**Why:** the renderers were moved by hand across six files, and `text` is a public
interface. A golden test pins it so a later payload change cannot silently reword
what Claude Desktop sees.

- [ ] **Step 1: Write the test** — full-string equality (not regex) for the sleep,
  heart rate, stress and VO2 max blocks against a one-row fixture each. If a line
  differs, fix the renderer, not the test — unless the original code genuinely
  produced the other string, in which case record why in the commit.

- [ ] **Step 2: Register it in `package.json` and run it.**

- [ ] **Step 3: Full verification** — `npm test && npm run typecheck && npm run lint && npm run build`.
  Expected: all pass, no regression from 92 tests.

- [ ] **Step 4: Commit** — `test: pin the MCP text output of every renderer`

---

## What this unblocks

- **Plan 2 (history store):** ingest writes `daily_metric` rows straight from
  `SleepPayload.nights`, `HeartRatePayload.days`, `StressPayload.days` and
  `Vo2MaxPayload.entries` — no second mapping layer, no duplicated field names.
- **Plan 3 (detectors):** detectors read typed arrays; their tests stay pure.
- **Plan 4 (surfaces):** watch, dashboard and agent loop read the same payloads,
  so a field cannot exist on one surface and not another.
