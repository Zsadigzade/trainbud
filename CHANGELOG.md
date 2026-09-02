# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] — watch 1.3.1 - 2026-09-02

Nobody who installed the watch app from the store could ever pair it. Reported
from a Forerunner 55 on firmware 11.03; it affected every user on every device.

### Fixed — watch

- **The store build shipped a default Server URL pointing at a developer's
  personal ngrok tunnel.** From 1.2.0 onward `properties.xml` carried
  `https://backpedal-immorally-cathouse.ngrok-free.dev` as the default, so a
  fresh install found a non-empty URL, skipped the setup screen entirely, POSTed
  `/api/pair` at a host that was usually offline, and rendered "Pairing failed"
  forever. The tunnel answers `ERR_NGROK_3200` when it is not running; the watch
  read the HTML error page as `-400` and reported a pairing failure. The default
  is now empty, which routes a fresh install to a **Setup required** screen
  naming the setup guide. Sideloading keeps a baked URL through the new
  `ciq/monkey-dev.jungle` overlay, which is gitignored and never in a store
  build.

  The same default was a privacy hazard in the other direction: while that
  tunnel was up, a stranger's watch minted a pairing code against the
  developer's own health server, one approval click away from handing out a
  bearer token to somebody else's Garmin data.

- **One "Pairing failed" screen became three, each naming what the user can
  fix.** *Cannot reach server* (nothing answered), *Not a TrainBud server*
  (something answered and it was not us — a dead tunnel, a captive portal, the
  wrong address), *Server refused pairing*. The address in use is drawn on
  screen whenever the address is the suspect, and `-104`, `-1001` and `429` get
  their own one-line hints. `-1001` distinguishes a plain `http://` URL from an
  `https://` one whose certificate was refused: the same code, two different
  problems, and telling a self-hosted user to "use https" when they already do
  is a dead end.

- **Round screens were detected by measuring pixels rather than asking the
  device.** `isRoundScreen()` was `width == height && width >= 240`, so the
  Forerunner 55 — round, 208×208 — was treated as rectangular and drew the
  recovery bar instead of the ring. Now `System.getDeviceSettings().screenShape`.

- **Text wrapped to a fixed character count, which a circle does not honour.**
  A line near the top of a round screen has far less room than one through the
  middle; "Cannot reach server" rendered as "annot reach serve". Wrapping is now
  measured in pixels against the chord width available at that height.

- **The five button-only products could not navigate.** `BehaviorDelegate` maps
  UP and DOWN to `onNextPage`/`onPreviousPage` and neither was implemented, so
  on fr55, fr745 and the three Instinct 3 variants the carousel only moved
  forwards one START press at a time and the Ask menu could not be scrolled at
  all. Every on-screen hint also said "tap"; hints are now chosen from
  `System.getDeviceSettings().isTouchScreen`.

- **Grey was invisible on the Forerunner 55.** Its palette holds eight colours
  and none of them is grey, so `COLOR_DK_GRAY` snapped to black on a black
  background: inactive page dots, faded Ask items, card footnotes and the ring
  track all vanished. Secondary elements use a colour that survives the palette,
  and inactive dots are outlined rather than filled, so the hierarchy is carried
  by shape.

- **Pairing telemetry is debug-only.** The pairing screen drew `9/8 200` in the
  corner of a store build — unexplainable to a user, and the difference between
  a poll that never ran and one discarded on the device to anyone debugging.

- **The AI disclaimer is now on screen.** The string existed from 1.2.0 and was
  never drawn anywhere, so the app made training and recovery statements on a
  health device with nothing to qualify them. It renders on the last page of an
  answer.

### Fixed — watch, found by drawing it

Everything below was found by running 1.3.1 in the simulator on a Forerunner 55
and a fenix 8 47mm and looking at every card. None of it was visible from the
source, the type checker or a green build, and none of these screens had ever
been drawn on any watch: 1.3.0 shipped its `.iq` without a single render.

- **The Today card printed its first finding through its own title,** and cut a
  character off each end of it: "Resting HR 4 bpm above" drew as "esting HR 4 bpm
  above". It centred the text block on the screen rather than in the space below
  the heading, and wrapped to a fixed 24 characters. This is card 0 — the first
  thing a paired user sees.

- **The Sleep card drew an empty yellow box next to "6.3".** The FONT_NUMBER_*
  faces contain digits and separators and no letters, so the "h" rendered as a
  missing-glyph box — and a box has a width, so the "does this fit" check passed
  and the value never stepped down to a font that has letters. The Recovery
  card's "No data" had the same fault waiting.

- **The Ask AI card printed the selected prompt underneath its own hint:**
  "Why is my re[STA]sting HR up?". The hint was right-justified against the
  screen edge at the vertical centre, which on a circle is exactly where the
  widest line already is.

- **The carousel dead-ended on the Ask card.** Going back from the first prompt
  left the card, but going forward from the last one wrapped around, so the six
  metric cards after it could only be reached by paging *backwards* from Today.
  It now leaves at both ends, on buttons and on swipe.

- **The AI Insight card overlapped its own lines on large screens.** The line
  step was a hardcoded 20 px, which is about right for the 208 px Forerunner 55
  and much too small for a 454 px fenix. Every hardcoded line step is now
  derived from the font.

- **The Recovery card printed "Ready" through the bottom of the score,** for the
  same reason: the label sat at a fixed offset from the centre while the score
  is drawn in a font whose height nearly doubles between those two devices. The
  label and the heart rate line are now stacked off the score's measured height.

- **"Resting 48  Max 178" lost its last digits** at the bottom of a 208 px round
  screen. It now shortens the *label* before the number: "Rest 48  Max 178".

- Activity card: the workout name was cut to 14 characters before being drawn,
  which threw away room a smaller font would have used. `drawFittedValue`
  already measures and steps down; the character cut is gone. This was the last
  item open on that card.

### Fixed — "AI unavailable" meant four different things

Reported as "it still shows AI Unavailable". The cause on this install was that
**no Anthropic key had ever been configured**: the settings table was empty,
`.env` had no `ANTHROPIC_API_KEY`, and the only two prompt jobs ever created, on
2026-08-17 and 2026-08-19, both failed with
`ANTHROPIC_API_KEY not configured`. AI is bring-your-own-key and genuinely could
not run. The defect is that the watch could not say so.

- **`/api/watch` now carries `ai_configured`.** `ai_insight: null` meant three
  different things — no key, a failed call, or today's insight not generated
  yet — and the watch drew one screen for all of them. The Ask card now shows
  **"AI not set up / Add an API key in the dashboard"** instead of offering five
  questions that cannot succeed, and the AI Insight card no longer tells a user
  with no key that there is "No insight today", which is a claim about today. A
  summary from an older server carries no such field; missing is read as
  configured, so nothing is asserted on no evidence.

- **The watch threw away the reason a prompt failed.** `GET /api/prompt/<id>`
  returns the server's error string, and `onPromptStatusReceived` read only
  `status` — so a missing API key and a provider outage rendered identically.
  The reason is now drawn under the message, along with a timeout and the HTTP
  code from a failed submit.

- **`trainbud check` reported AI status from the environment only.** It read
  `appConfig.anthropicApiKey` instead of `isAiConfigured()`, so a key saved
  through the dashboard — the route the setup guide tells users to take — was
  reported as absent forever. `resolveAnthropicKey()` exists for exactly this
  and this call site never used it.

### Fixed — dependencies

- `qs` 6.15.3 → 6.16.0 and `fast-uri` 3.1.5 → 3.1.7, clearing one high and one
  moderate advisory. `npm audit` is clean.

### Removed

- Dead resources and code: `drawHint()` and the `TapHint` string it drew
  (replaced by page dots in 1.2.0), plus the unused `AskHint`, `PairingPolling`
  and `CardHeartRate` strings.

## [0.3.1] - 2026-08-19

Watch pairing works. It never had, on any build, and the cause was the last one
still open: a status poll that never reached the server.

### Fixed — watch

- **Pairing completes end to end.** ngrok's free tier answers any GET carrying a
  browser-ish User-Agent with an HTML interstitial under a 200. Connect IQ sends
  `Mozilla/5.0` and will not let an app override it, so every status poll was
  answered by the tunnel, never reached the server, and failed on the watch as
  `-400 INVALID_HTTP_BODY_IN_NETWORK_RESPONSE`. POSTs are not intercepted, which
  is why `/api/pair` always worked and the poll never did. Verified in the
  simulator against the live tunnel: code issued, approved in the dashboard,
  credentials saved, summary fetched.
- Recovery ring drew the inverse of the score: the end angle is measured
  clockwise but the arc was drawn counter-clockwise, so 91 rendered as the
  missing 9%.
- Recovery ring overlapped the card title.
- Fractional values drew with six decimal places (`6.300000h`), on both the
  widget and the glance.
- The four-cell overview grid used "No data" as its placeholder, which drew over
  the neighbouring cells and their labels; it now uses a dash.
- Activity card: subtitle and footnote collided, and a strength workout listed
  "0 km" as though zero were a measurement.

### Fixed — server

- **Recovery score was NaN on every default call** and reached the watch as
  `null`: normalizeWeights spread an object of explicit `undefined` weights over
  its defaults, and `NaN <= 0` is false so the guard missed it.
- **Stress and VO2 max were fetched from URLs Connect answers 404 for.** Both
  take the date as a path segment; VO2 max is `maxmet/latest`, not
  `maxmet/daily`. The stress mapper also read fields the response does not
  contain (`overallStressLevel` rather than `avgStressLevel`), and Connect's
  negative "not measured" sentinels were averaged in as real readings.
- Pair codes came from `Math.random()`. `/api/pair` is unauthenticated by
  design, so an attacker could mint codes, recover the PRNG state, predict the
  code the watch was showing and collect the API key on approval. Now
  `crypto.randomInt`.
- Rate limiting only ever ran on `/mcp`, leaving the unauthenticated pair
  endpoints open to a walk through the six-digit code space; and buckets were
  keyed on the socket address, which behind a tunnel is one bucket for every
  client. Limits now cover every route, with a tighter budget for pairing, keyed
  on the forwarded address.
- API key compared in constant time.
- `.env`, `session.json` and the MCP client config were written world-readable
  (0644) and are now 0600.
- A single failed Garmin login was memoised and poisoned every later call until
  the process restarted.
- All four npm audit advisories cleared.

### Added

- Real Connect IQ Store screenshots, captured from a paired app in the
  simulator (`ciq/store/screenshots/`). The previous set was drawn in PowerShell
  and removed in 1.2.0.
- Tests: pair code randomness, pair rate limiting, secret file permissions,
  client auth lifecycle, the real Connect stress payload, recovery weights.
  91 tests, up from 73.

## [0.2.0] - 2026-06-26

### Fixed

- **Critical:** Logger no longer writes to stdout — pino-pretty uses stderr; file logging starts only when server starts
- **Critical:** Credentials validated at server startup, not on first tool call
- N+1 Garmin API calls batched with concurrency limit (`mapInBatches`, max 6 parallel)
- Body composition fetches parallelized instead of sequential
- Activities range queries use shared paginated pool cache (up to 500 activities) with truncation warning
- Cache keys unified via `buildToolCacheKey()` with stable sorted-param hashing
- Recovery tool uses yesterday's sleep data with fallback to prior nights
- Activity date filtering uses consistent Luxon parsing
- Session path resolved from single `getSessionPath()` in config
- Version read from `package.json` instead of hardcoded strings
- `GarminApiError` is now a proper class; auth retry uses `await`
- Tool errors sanitized before returning to MCP clients
- SQLite cache closed on SIGTERM/SIGINT/exit

### Added

- `src/version.ts`, `src/utils/batch.ts`, `src/garmin/garminApiTypes.ts`, `src/tools/types.ts`
- `filterActivitiesByRange()`, `sanitizeErrorMessage()`, `getYesterday()` helpers
- `configureLogger()` for lazy log file initialization
- `.nvmrc` (Node 20)
- `.github/workflows/publish.yml` for npm + GitHub Releases on version tags
- Project knowledge base moved to Obsidian vault (`05-Projects/trainbud/`); see `docs/VAULT.md`
- 11 new tests (32 total): cache key stability, date filtering, recovery scoring, error sanitization

### Changed

- **Rebranded** from garmin-mcp to **TrainBud** (package `trainbud`, CLI `trainbud`)
- README rewritten as product page with disclaimer, badges, and security section
- Added CONTRIBUTING.md; updated vault docs and examples
- Removed imports from internal `garmin-connect/dist/` paths
- Tool registry uses shared `ToolDefinition` interface without unsafe casts
- `runCacheClear` is synchronous

## [0.1.0] - 2026-06-26

### Added

- Initial MCP server exposing 6 Garmin Connect tools
- Email/password authentication with session persistence (`.trainbud/session.json`)
- SQLite caching layer with configurable TTL per resource type
- CLI commands: `start`, `auth`, `cache clear`, `status`
- Unit and integration tests using Node test runner
- README, QUICKSTART, and example prompts

### Notes

- Uses unofficial `garmin-connect` npm package (Windows/macOS/Linux compatible)
- MFA is not yet supported by the underlying library
