# TrainBud memory layer — design spec

**Date:** 2026-08-20 · **Status:** agreed · **Supersedes:** nothing

## Problem

TrainBud mirrors Garmin. Every number on the watch — recovery, sleep, stress,
VO2 max — is a number Garmin Connect already shows on the same wrist. The AI
layer does not change that, because it is amnesiac by construction:

- `GarminCache` is TTL-keyed and deletes its own rows on expiry
  (`src/garmin/cache.ts`). Nothing is retained.
- `app.db` holds settings, pair tokens and prompt jobs. No time series, no
  profile, no conversation history (`src/appDb.ts`).
- Every Claude call receives one day's snapshot, assembled fresh
  (`formatHealthContext`, `src/promptApi.ts`), capped at 300 tokens.
- Watch input is five hardcoded strings (`ciq/resources/strings/strings.xml`).

Garmin cannot be beaten on measurement. It can be beaten on memory,
cross-metric reasoning, free-form "why", and knowing who the user is.

## Decisions

| Area | Decision |
|---|---|
| Store | Normalized `daily_metric` table plus a raw blob archive. 365-day backfill, stopping early where the record runs out. |
| Ingest | Catch-up on `trainbud serve` start, then hourly while the process lives. Cache-first, ~1 request/second, sequential, resumable, checkpointed after every date. Abandons a source after 60 consecutive empty days — see "How much history there actually is". |
| Revisions | Upsert on `(date, kind)`; every fetch appends a raw blob, so restatements stay visible instead of being silently overwritten. |
| Context capture | MCP write-tools (conversational), a one-tap RPE picker on the watch, a minimal dashboard form, and Garmin's own per-activity feel field. |
| Detection | Deterministic TypeScript against a rolling 28-day personal baseline. The model phrases findings; it never decides them. |
| First detectors | Resting HR elevation, sleep debt, HRV trend break on measured `avgOvernightHrv`, acute:chronic load ratio on self-computed TRIMP. |
| Load metric | Banister TRIMP from duration and average HR. Garmin's `activityTrainingLoad` is not in the payload we fetch and is absent for many activity types. |
| Safety | Findings state data, never cause. Advice covers training load only — never illness, never diagnosis. |
| Q&A | Server-side agentic tool loop reusing `executeTool()`. One registry, three consumers: MCP, watch, dashboard. |
| Models | Sonnet for the tool loop, Haiku for the daily sentence. Watch answers capped at 2–3 sentences by rendering, not by reasoning. |
| Watch layout | Card 0 findings, card 1 contextual Ask, metric cards demoted behind them. Glance shows the live flag. |
| Ask presets | Generated daily from actual findings, served by the API, not read from `strings.xml`. |
| Daily insight | Regenerated from findings rather than from the current snapshot. |
| Fixtures | Real Garmin payloads, captured by ingest, redacted, committed. |
| Prerequisite | Tools return structured data; text is rendered at the edge. Kills the regex parse in `src/watchApi.ts`. |

## Rejected

- **Workout write-back.** Highest usefulness, highest liability, unofficial
  write API. Not in scope.
- **LLM as detector.** Cannot be unit-tested and phrases a hallucinated trend
  exactly as confidently as a real one. This project's entire bug history is
  numbers being silently wrong.
- **HRV detection on the composite recovery score.** The score is hand-weighted
  and self-invented; a trend on it is a trend on our own arithmetic, and it
  double-counts sleep and stress which have their own detectors.
- **`Toybox.Background` temporal service.** True push to the wrist, but the
  highest-risk Connect IQ work available and unverified per device. Glance
  carries the flag instead.
- **Batched/parallel backfill.** `src/utils/batch.ts` exists, but the account is
  the thing at risk and there is no appeal process.

## Constraints inherited from the codebase

- Node >= 20, ESM, `.js` extensions on relative imports.
- Tests run under `node --test` via `npm test`; each file must be listed in the
  `test` script in `package.json`.
- Connect IQ web requests fail silently — see the vault trap note. Any watch
  change needs simulator verification, not a green build.
- The watch is `type="widget"` with no background service: it does nothing while
  the user is not looking at it.
- `-400 INVALID_HTTP_BODY_IN_NETWORK_RESPONSE` on the watch means only
  "something returned HTML". Check the tunnel serves before reading into it.

## Sequencing

1. Land `fix/deep-audit`, tag server 0.3.1, upload watch 1.2.1. (Human.)
2. **Plan 1** — structured tool output. Prerequisite for everything below.
3. **Plan 2** — history store, backfill, ingest, payload capture, fixtures.
4. **Plan 3** — detectors and findings.
5. **Plan 4** — surfaces: glance flag, watch reorg, dynamic presets, dashboard
   form, MCP write-tools, agentic Q&A loop.

## How much history there actually is

The first real backfill, 2026-08-20, settled a question the plan had assumed
away. **This account's record starts 2026-06-09, the day the fr70 was bought.**
Of the 365 days asked about per source, 296 came back empty on the very first
source, and the store had logged 472 empty days before the run was half done.

Three consequences:

- **A year of backfill is ~1180 wasted requests** against an unofficial API,
  spent on months when the device did not exist. Ingest now abandons a source
  after 60 consecutive empty days, walking newest-first. 60 rather than
  something tighter because a real person stops wearing a watch sometimes — an
  injury, a holiday, a flat charger — and the history behind such a gap is still
  worth having. `backfill --no-early-stop` walks the whole window anyway.
- Abandoned days are **not checkpointed**. Skipping is not the same claim as
  "we asked and there was nothing", so a later run can still reach them.
- **Seasonal and year-over-year comparison is not available yet**, and will not
  be until mid-2027. Nothing should be built that assumes it. Detectors are
  unaffected: they need 28 days and there are ~70.

`trainbud status` reports the empty-day count so a short span reads as "that is
all Garmin has" rather than as a broken backfill.

## Cold start

With no history, detectors produce nothing and the app is exactly as useful as
it is today. Every surface must degrade to "still gathering data" rather than to
an empty card or a null.

This is not hypothetical for a new user, and it is not rare: a watch bought this
month has no baseline at all for two weeks, which is most of the window in which
someone decides whether the app is worth keeping.
