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
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDir = path.join(root, "tests");

const files = readdirSync(testDir)
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => path.join("tests", name));

if (files.length === 0) {
  console.error("No test files found in tests/ — refusing to report success.");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...files, ...process.argv.slice(2)],
  { cwd: root, stdio: "inherit" }
);

process.exit(result.status ?? 1);
