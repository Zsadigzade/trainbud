# Overnight log

Shared memory across autonomous sessions. Newest entry at the bottom. Read the
last few entries before starting work so two sessions do not do the same thing.

## 2026-09-07 21:20 UTC — local session

Claiming the open roadmap item **"Workout comparison"** and implementing it now.
If you are the hourly cloud routine and this entry is the most recent one, pick
something else: skip roadmap item 2 and go to test-coverage gaps or dependency
updates instead.

Already shipped to `main` this evening by the local session, so do not redo:

- `8ce33df` client aborts no longer logged as server errors
- `0e9a55b` `trainbud check` covers 12 of 14 tools, 2 excused, gap now reported
- `527b701` unparseable body answers 400/-32700 instead of 500/-32603
- `935881a` restored 7 security/device-token tests an earlier commit overwrote
- `9f901e3` tests pinning the pairing rate limit's client-key rules

Suite is 589 tests, 587 passing, 2 skipped. `npm audit` is clean.

## 2026-09-07 21:45 UTC — local session

**Workout comparison is done and on `main`** (`a56bc65`). The roadmap item is
ticked; do not start it again. `compare_workouts` is registered, has a live
check in `trainbud check`, and is covered by `tests/compareWorkouts.test.ts`.

Suite: 599 tests, 597 passing, 2 skipped. Typecheck, lint and CI all green.

Nothing on the README roadmap is unchecked now. If you are the hourly routine,
go to test-coverage gaps or a single dependency update — `better-sqlite3` is a
major version behind (12.11.1 declared, 13.0.3 published) and is the one worth
looking at, carefully, since it is a native module and the CI matrix runs Node
20 and 22. `npm audit` reports 0 vulnerabilities.

No release has been cut. Version is still 0.5.2 and CHANGELOG has no entry for
tonight's work yet.

## 2026-09-07 21:35 UTC — local session (collision notice)

**Two sessions built `compare_workouts` at once.** The 21:17 cloud fire cloned
the repo three minutes before the claim above was pushed, so it started the same
roadmap item in good faith. Not its fault; the claim simply arrived late.

What is on `main` is the local implementation:

- `src/detect/compare.ts` — pure arithmetic, `src/tools/compare.ts` — the tool
- reads the local store (works with Garmin unreachable, like `get_findings`)
- picks comparables by closeness of scale, ±20% on distance or duration
- withholds a "typical" value below three samples
- honours `getProfile().units`, so pace is per mile and elevation in feet on an
  imperial profile (`7eb1848` — that gap came from reading the cloud attempt)

The cloud attempt (`src/tools/workoutComparison.ts`, baseline-average over a
day window, percent change) is **not** on main and should not be merged as-is:
a second tool registered under the same name `compare_workouts` breaks the
pinned registry assertion in `tests/contextTools.test.ts` and would register a
duplicate name with MCP.

If anything from it is worth keeping, port the idea into `detect/compare.ts`
rather than adding a second tool. Percent change alongside the absolute delta
is the one worth considering.

**Do not implement workout comparison again.** The roadmap item is ticked.

## 2026-09-07 21:40 UTC — local session: 0.6.0 released

**0.6.0 is published.** Do not cut another release tonight unless something
lands that genuinely needs to reach users; batch further work into 0.6.1/0.7.0.

- npm: `npm view trainbud version` → 0.6.0
- Executed from outside the repo: `npx --yes trainbud@0.6.0 --version` → 0.6.0
- GitHub release `v0.6.0` exists and is not a draft
- Publish workflow run 34163821083: success

Contents: `compare_workouts`; the client-abort log fix; the `-32700` parse-error
fix; `trainbud check` covering 12 of 14 tools; the budget cap that could not be
verified no longer being treated as no cap; and tests for the security headers
and the rate-limit identity.

`package-lock.json` had said 0.3.1 since before 0.4.0 and is now synced.

**Behaviour change shipped:** with a monthly cap set and an unreadable
`app.db`, Ask and the daily insight fail closed. With no cap set, unchanged.
