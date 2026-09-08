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

## 2026-09-07 22:10 UTC — local session

**Do not cut a release.** `main` now carries an unreleased change that raises the
supported Node floor from 20 to 22.12 (`f06702d`), and that is being held
deliberately for the repo owner to approve, because it changes who can install
the package and contradicts launch copy already posted publicly. Version stays
0.6.0 until they say otherwise. This overrides the general release authority for
tonight.

Why it exists, so nobody undoes it by accident: `better-sqlite3@12.11.1` ships
no prebuilt binary for Node 20 on any platform — earliest is ABI 127, Node 22 —
so every Node 20 install compiles from source and needs a C++ toolchain. The
ubuntu CI job only ever passed because GitHub's runner has a compiler. Adding
`windows-latest` to the matrix reproduced what a real Windows user gets:

    gyp ERR! stack Error: Could not find any Visual Studio installation to use

CI is now ubuntu 22 and 24, windows 22, macos 22 — all four green.

Also on main since the last entry, all tested and CI-green:

- `f882df0` compare_workouts no longer claims "first of its kind" when earlier
  same-sport workouts exist outside the distance tolerance, and a displayed
  delta is derived from the displayed endpoints (it read "24 m vs 38 m — 15 m
  lower")
- `7fda4e5` `npm run test:coverage` works for the first time (Node's own
  runner); vitest removed, it could never collect a `node:test` suite
- `21362f9` the plugin skill listed 9 of 15 tools; both copies of the list are
  now pinned to the registry by tests

Good next work if you are the hourly routine: `better-sqlite3` is a major behind
(12.11.1 declared, 13.0.3 published). Check whether 13.x publishes prebuilds for
the same platforms before proposing it, and do not release it either.

## 2026-09-07 22:38 UTC — the cloud routine is disabled, and why

**The hourly routine has read-only GitHub access, so it can never ship.** Both
fires did real work and lost all of it:

- `git push` → `403: Claude doesn't have GitHub access to Zsadigzade/trainbud
  for your organization`
- The GitHub App's write API (branch creation, for the PR fallback) →
  `403 Resource not accessible by integration`

Reads work — it listed PRs and resolved the account fine — so this is a write
permission gap, not connectivity. Its commits live only in a sandbox that is
discarded when the fire ends.

Fire 1 (21:17) implemented workout comparison, colliding with the local session.
Fire 2 (22:18) did something genuinely useful: it found that
`tests/compareWorkouts.test.ts` covers only the pure arithmetic, leaving
`src/tools/compare.ts` at 14% function coverage, wrote tests for it, and
verified they catch regressions by sabotaging the sort and watching them fail.
That finding has been re-implemented locally and pushed as part of the tool
coverage commit; the routine's own copy is gone.

**Disabled at 22:38** so it stops spending budget on work that cannot land, and
stops sending push notifications about the same blocker every hour.

**To re-enable, fix the access first**, otherwise it will do this again:

1. Install or reconnect the Claude GitHub App with write access to this repo:
   <https://github.com/apps/claude/installations/select_target>, or reconnect
   GitHub from <https://claude.ai/customize/connectors>
2. Re-enable the routine at <https://claude.ai/code/routines/trig_019MgHPoFBhziq33DBRiVyp7>
3. Confirm it can push before trusting it with anything: the first fire should
   land a log entry here.

## 2026-09-08 04:45 UTC — dependencies swept; TypeScript 7 deliberately not taken

Everything `npm outdated` listed is now current except TypeScript, one at a time
with verification beyond the suite each time:

- **better-sqlite3 13.0.3.** 12.x fetches a binary at install time through the
  deprecated `prebuild-install`; 13.x ships them inside the tarball
  (`prebuilds/` covers darwin, linux, linuxmusl and win32, arm64 and x64), so
  there is no download and no compiler in the path. Its `engines` is `>=22`,
  which is exactly the floor this repo moved to. Checked against the real 22 MB
  history database, not just the suite.
- **@modelcontextprotocol/sdk 1.30** — verified over the protocol: a server
  built from that commit listed all fifteen tools and answered a real
  `compare_workouts` call.
- **zod 4.5.4** — verified where it matters: a bad `nights` argument is still
  rejected with an input validation error.
- **@anthropic-ai/sdk 0.124** (eighteen minors) — verified with a real
  `messages.create` against the live API in the exact shape `promptApi.ts`
  sends. The call site uses no `thinking`, `budget_tokens`, prefill or
  `output_format`, so nothing needed migrating.
- **Types and lint tooling** — `@types/better-sqlite3` to 9.x to match the
  driver, plus `@types/luxon`, `@types/node`, `eslint`, `tsx`,
  `typescript-eslint`.

**TypeScript 7 was tried and reverted. Do not take it yet.** It typechecks,
builds (fast — it is the native port) and passes all 632 tests, but linting
stops working entirely:

    typescript-eslint does not support TS 7.0.
    ... tracking: typescript-eslint#10940

Trading a working lint for a faster build is not a trade worth making, and the
side-by-side TS 6 workaround is more machinery than the speed is worth today.
Revisit when typescript-eslint ships TS 7 support.

One operational note for anyone repairing dependencies on the dev machine:
**`npm ci` fails while the local server is running.** It deletes `node_modules`
wholesale and Windows refuses, because the running process holds
`better-sqlite3`'s native binary open. `npm install` repairs the tree without
stopping the server.

## 2026-09-08 04:52 UTC — correction: better-sqlite3 13 was reverted

The entry above says 13.0.3 was adopted and verified. That was wrong, and the
error is worth naming precisely because it is easy to repeat.

**13.0.3 broke the Windows CI job**, and it was reported as green. The polling
loop used to wait for CI broke on the first `completed` status it saw and then
printed the jobs of `gh run list --limit 1` — which, before the new run had been
created, was the *previous* commit's run. Five commits went out on top of a red
main before anyone looked at the job list directly.

The technical part: 13.x ships binaries inside the tarball, which is why a local
`npm install` on Windows needed no compiler and looked like proof. Under
`npm ci` in a clean checkout — the path CI, contributors and releases all take —
it still goes to node-gyp and fails with `Could not find any Visual Studio
installation to use`. A bundled prebuild is not the same thing as an install
that works.

Reverted to **12.11.1**, which fetches through `prebuild-install` and is green on
ubuntu 22/24, windows 22, macos 22 and the Docker build. The deprecation warning
it prints is the price of an install that works.

The rest of the sweep stands and is unaffected — none of it touches the native
path.

**Method note for the next agent:** wait for the run whose head SHA is the
commit you just pushed. Breaking on "a run completed" reads whatever ran last.
