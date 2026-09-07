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
