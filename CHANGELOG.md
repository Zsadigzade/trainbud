# Changelog

All notable changes to this project will be documented in this file.

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
