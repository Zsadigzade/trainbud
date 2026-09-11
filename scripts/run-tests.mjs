/**
 * `npm test` used to list all thirty-six test files by hand inside package.json.
 * A file the list forgot never ran, and nothing anywhere said so -- the suite
 * would report every test passing while a whole file sat unexecuted. The list
 * happened to be complete when this was written, which is the only reason it
 * had not already hidden a regression.
 *
 * Node's own `--test` glob would do this, but it needs Node 22 and this package
 * declares `engines.node >= 20`, so the discovery happens here instead.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDir = path.join(root, "tests");

/**
 * Give the suite a data directory of its own.
 *
 * `npm test` used to HANG with no output whenever a `trainbud serve` was
 * running, and the reason was never printed anywhere: `app.db` is resolved
 * beside `appConfig.cachePath`, which defaults into the project's own
 * `.trainbud/`. So the suite opened the same SQLite file the live server had
 * open, and better-sqlite3 blocked -- synchronously, forever, with no timeout
 * and no message. After 2026-09-11 the server runs from a scheduled task and is
 * therefore ALWAYS up, which would have turned an occasional hang into a suite
 * that never runs again.
 *
 * Pointing the cache path at a fresh temporary directory fixes the deadlock and
 * something worse that nobody had hit yet: a test that wrote through to the
 * developer's real database. An individual test that wants its own path still
 * sets one -- this is a default, not an override.
 */
const scratchDir = mkdtempSync(path.join(os.tmpdir(), "trainbud-tests-"));
process.env.TRAINBUD_CACHE_PATH ??= path.join(scratchDir, "cache.db");
process.env.TRAINBUD_SESSION_PATH ??= path.join(scratchDir, "session.json");
process.env.TRAINBUD_LOG_PATH ??= path.join(scratchDir, "trainbud.log");

const files = readdirSync(testDir)
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => path.join("tests", name));

if (files.length === 0) {
  console.error("No test files found in tests/ — refusing to report success.");
  process.exit(1);
}

// Anything passed through goes BEFORE the file list. Node ignores a flag that
// arrives after the first file argument, which is how 
// silently produced a full green run and no coverage report at all.
const forwarded = process.argv.slice(2);

const result = spawnSync(
  process.execPath,
  [...forwarded, "--import", "tsx", "--test", ...files],
  { cwd: root, stdio: "inherit", env: process.env }
);

// Best effort. A leftover temp directory is untidy; failing the suite over one
// would be worse than untidy.
try {
  rmSync(scratchDir, { recursive: true, force: true });
} catch {
  // The suite's own result is the only thing that decides the exit code.
}

process.exit(result.status ?? 1);
