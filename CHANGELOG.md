# Changelog

All notable changes to this project will be documented in this file.

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
