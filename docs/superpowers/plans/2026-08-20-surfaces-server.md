# Surfaces, Server Side — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get findings, and the user's own context, out of the store and onto
every surface — starting with everything that can be built and tested without
Connect IQ.

**Architecture:** A `user_context` layer in the history database for goals,
injuries and subjective entries; MCP write-tools so Claude can record them
conversationally; findings and coverage carried in the `/api/watch` payload
alongside the metrics; the daily insight regenerated from findings rather than
from today's snapshot; and the Ask menu's five prompts generated daily from what
actually fired.

**Tech Stack:** TypeScript 6 (ESM), better-sqlite3, luxon, Anthropic SDK, `node --test`.

**Spec:** `docs/superpowers/specs/2026-08-20-memory-layer.md`

**Depends on:** the structured-tool-output, history-store and detectors plans
(all complete).

**Deliberately excluded, to their own plans:**
- **4b, Connect IQ** — card reorder, findings card, glance flag, preset
  rendering, the RPE picker. Every one needs simulator verification, and a green
  build proves nothing about this watch.
- **4c, the agentic Q&A loop** — a server-side Claude tool loop over the tool
  registry.

## Global Constraints

- Node >= 20, ESM only, `.js` on relative imports.
- New test files must be listed in the `test` script in `package.json`.
- `npm run typecheck` and `npm run lint` pass before every commit.
- **The `/api/watch` JSON is a contract with a watch already on someone's
  wrist.** Fields may be added; none may be renamed or removed. Watch 1.2.1
  ignores what it does not know about, so additions are safe.
- **Findings state data, never cause.** Anything the model phrases is
  constrained to what a `Finding` already said, and to training advice.
- Cold start reads `coverage.ready`, never the length of the findings array.

---

### Task 1: The user context store

**Files:**
- Modify: `src/history/schema.ts` (two tables)
- Create: `src/history/context.ts`
- Create: `tests/historyContext.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `type ContextKind = 'goal' | 'race' | 'injury' | 'note'`
  - `type SubjectiveKind = 'rpe' | 'soreness' | 'mood'`
  - `interface ContextEntry { id: number; kind: ContextKind; text: string; effectiveFrom: string; effectiveTo: string | null; createdAt: number }`
  - `addContextEntry(kind, text, options?: { effectiveFrom?: string; effectiveTo?: string }): ContextEntry`
  - `activeContext(onDate: string): ContextEntry[]`
  - `closeContextEntry(id: number, onDate: string): boolean`
  - `logSubjective(date: string, kind: SubjectiveKind, value: number, note?: string): void`
  - `subjectiveSeries(kind: SubjectiveKind, startDate: string, endDate: string): Array<{ date: string; value: number; note: string | null }>`

**Why a date range rather than a flag:** an injury heals and a race happens. An
entry that is only ever "current" has to be deleted to stop being true, which
loses the fact that it *was* true — and "how did the last build go, when the
achilles was bad" is exactly the question this layer exists to answer.

- [ ] **Step 1: Write the failing test** — an entry round-trips; `activeContext`
  includes an entry whose range covers the date and excludes one that closed
  before it or starts after it; an open-ended entry (`effectiveTo: null`) stays
  active indefinitely; `closeContextEntry` sets the end date and the entry then
  drops out of `activeContext` for later dates but **remains** for earlier ones;
  `logSubjective` upserts on `(date, kind)`; a value outside 1–10 is rejected.

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Add the tables to `schema.ts`** and write `context.ts`, in the
  shape of `store.ts`.

- [ ] **Step 4: Verify, commit** — `feat: a place to record goals, injuries and how a session actually felt`

---

### Task 2: MCP tools for reading findings and writing context

**Files:**
- Create: `src/tools/context.ts`
- Create: `src/tools/findings.ts`
- Modify: `src/tools/index.ts` (registry, `toolSchemas`)
- Create: `tests/contextTools.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces four tools, added to `toolRegistry` and `toolSchemas`:
  - `get_findings` — what stands out, with coverage
  - `remember_context` — a goal, race, injury or note, with an optional date range
  - `log_subjective` — RPE, soreness or mood for a day
  - `get_user_context` — what is on record

**Why write-tools rather than a form first:** the richest input the user will
ever give is a sentence they were already typing. "Half marathon on October 12,
left achilles grumbling since Tuesday" becomes two records with no UI at all.
The dashboard form in Task 5 exists so that a user without Claude is not locked
out of the differentiator.

- [ ] **Step 1: Write the failing test** — the registry lists thirteen tools; each
  new tool returns a `ToolResult` whose `data` matches the payload type and
  whose `text` names what was recorded; `remember_context` rejects an unknown
  kind with a message listing the valid ones; `log_subjective` rejects a value
  outside 1–10; `get_findings` on an empty store reports not-ready rather than
  "nothing found".

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Write both tool files and register them.** Payload types go in
  `src/tools/payloads.ts` beside the others.

- [ ] **Step 4: Verify, commit** — `feat: MCP tools to read findings and record context`

---

### Task 3: Findings on the watch payload, and an insight built from them

**Files:**
- Modify: `src/watchApi.ts` (`WatchSummary` gains `findings` and `coverage`)
- Modify: `src/promptApi.ts` (`formatHealthContext`, `generateDailyInsight`)
- Create: `tests/watchFindings.test.ts`
- Modify: `tests/watchApi.test.ts`, `package.json`

**Interfaces:**
- Produces:
  - `interface WatchFinding { kind: string; severity: string; headline: string }`
  - `WatchSummary.findings: WatchFinding[]`
  - `WatchSummary.coverage: { days: number; ready: boolean }`
  - `formatFindingsContext(result: DetectionResult, context: ContextEntry[]): string`

**Two constraints on the payload:**

1. **Additive only.** Watch 1.2.1 is paired and ignores unknown fields, so
   `findings` and `coverage` can appear without breaking it.
2. **`headline` is pre-rendered and short.** The watch cannot wrap arbitrary
   text well, and a 390 px round screen has already clipped a fixed-font
   activity name. The watch gets the sentence, not the numbers to build one.

**The insight changes input, not shape.** Same card, same one-sentence budget,
same daily cache — but `formatHealthContext` becomes "RHR +4 for 3 days, sleep
debt 4.2 h, half marathon Oct 12" rather than four current numbers. It stops
being a horoscope and starts referring to things that happened.

- [ ] **Step 1: Write the failing test** — `buildWatchSummaryFrom` carries
  findings through in severity order; an empty store yields `findings: []` with
  `coverage.ready === false`; `formatFindingsContext` includes every finding
  headline and every active context entry, and says "still gathering data" when
  coverage is not ready; the existing `tests/watchApi.test.ts` cases still pass
  with the two new fields present.

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Implement.** `generateDailyInsight` keeps its cache key and its
  fallback to yesterday's sentence on API failure.

- [ ] **Step 4: Verify, commit** — `feat: the watch payload carries findings, and the daily insight is built from them`

---

### Task 4: Ask prompts generated from what actually fired

**Files:**
- Create: `src/promptSuggestions.ts`
- Modify: `src/watchApi.ts` (`WatchSummary.prompts`)
- Create: `tests/promptSuggestions.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `buildPromptSuggestions(result: DetectionResult, context: ContextEntry[]): string[]` — always exactly five
  - `WatchSummary.prompts: string[]`

**Why this is the demo, not a nicety:** the current menu is five hardcoded
strings in `strings.xml` — "Should I train today?", "Am I overtraining?" — that
would read identically on an app with no memory at all. Generated from findings
they become "Why is my resting HR up 4 bpm?" and "Sleep debt is 4.2 h — what do
I do?", which are questions only this app could have known to offer.

**Rules:** exactly five, deterministic for the same input, most severe finding
first, back-filled from a fixed generic list when fewer than five findings
exist, and never longer than will render on a round screen (cap at 32
characters, since the watch's own strings sit near that).

- [ ] **Step 1: Write the failing test** — always returns five, whatever the
  input; a fired finding produces a prompt naming its subject; the same input
  twice gives the identical list; generic fill-ins appear only after
  finding-derived ones; an empty store returns the five generics; no prompt
  exceeds 32 characters.

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Implement, and add `prompts` to the watch payload.**

- [ ] **Step 4: Verify, commit** — `feat: the Ask menu offers what today's data raised`

---

### Task 5: A dashboard form, so context is not gated behind Claude

**Files:**
- Modify: `src/dashboard.ts`, `src/httpServer.ts`
- Modify: `tests/httpServer.test.ts`, `package.json`

**Interfaces:**
- Produces: `POST /dashboard/context` (add), `POST /dashboard/context/close`,
  and a context section in the rendered dashboard

**Why:** goals and injuries are the personalisation that makes a finding worth
anything, and without this they can only be entered by talking to Claude — so
for an open-source project most people never reach the differentiator.

- [ ] **Step 1: Write the failing test** — both routes reject without a bearer
  token; a valid post records an entry that `activeContext` then returns; an
  unknown kind is a 400 with a message naming the valid kinds; the rendered
  dashboard HTML contains the form and escapes user text.

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Implement**, matching the existing dashboard's fetch-and-toast
  pattern rather than introducing a second style. `escapeHtml` already exists
  and must be used on every echoed value.

- [ ] **Step 4: Verify, commit** — `feat: record goals and injuries from the dashboard`

---

## What this leaves for 4b (Connect IQ)

The payload will already carry `findings`, `coverage` and `prompts`. The watch
work is then rendering and navigation only: card 0 shows findings, card 1 reads
`prompts` instead of `strings.xml`, the glance shows the top headline, metric
cards move behind, and the RPE picker posts to `log_subjective`. No new server
work, and every field it needs can be inspected with `curl` before a line of
Monkey C is written.
