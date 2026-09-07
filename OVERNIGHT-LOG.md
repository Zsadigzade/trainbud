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
