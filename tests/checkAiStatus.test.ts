import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// `trainbud check` read the AI key straight off the environment, so a key saved
// through the dashboard -- the way the setup guide tells users to add one --
// was reported as absent forever. resolveAnthropicKey() exists precisely
// because the environment is only half the story, and this one call site never
// used it.
//
// The database path is derived from GARMIN_CACHE_PATH at module load, so both
// the env var and the dynamic imports have to happen before anything touches
// appDb. Writing into the real .trainbud/app.db is how a previous test broke
// this project's history database.

let tmpDir: string;
let originalCachePath: string | undefined;
let originalEnvKey: string | undefined;

describe("check reports AI as configured from a dashboard-saved key", () => {
  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-check-"));
    originalCachePath = process.env["GARMIN_CACHE_PATH"];
    originalEnvKey = process.env["ANTHROPIC_API_KEY"];
    process.env["GARMIN_CACHE_PATH"] = path.join(tmpDir, "cache.db");

    // Load config BEFORE clearing the key, not after.
    //
    // src/config.ts calls dotenv at module load, so importing anything that
    // reaches it re-reads the developer's own .env and puts ANTHROPIC_API_KEY
    // straight back. Deleting the variable in a `before` hook and then
    // dynamically importing promptApi therefore cleared nothing: the import
    // repopulated it.
    //
    // This test was green for the whole life of the project purely because no
    // Anthropic key had ever been configured on the machine it ran on. The day
    // a key was added to .env it failed -- not because the behaviour it checks
    // broke, but because the test had been asserting against the developer's
    // environment rather than against a controlled one. Force the load first,
    // then clear; appConfig.anthropicApiKey is a getter and reads process.env
    // at call time, so clearing afterwards is what actually takes effect.
    await import("../src/config.js");
    delete process.env["ANTHROPIC_API_KEY"];
  });

  after(async () => {
    // Windows keeps the SQLite file locked while the handle is open, so the
    // database has to be closed before the directory can go.
    const { closeAppDb } = await import("../src/appDb.js");
    closeAppDb();

    if (originalCachePath === undefined) delete process.env["GARMIN_CACHE_PATH"];
    else process.env["GARMIN_CACHE_PATH"] = originalCachePath;
    if (originalEnvKey === undefined) delete process.env["ANTHROPIC_API_KEY"];
    else process.env["ANTHROPIC_API_KEY"] = originalEnvKey;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds a key that exists only in the settings table", async () => {
    const { setSetting } = await import("../src/appDb.js");
    const { isAiConfigured } = await import("../src/promptApi.js");
    const { checkSetup } = await import("../src/check.js");

    // Guard the guard: if a later import ever puts the key back, the assertion
    // below would fail for a reason that has nothing to do with what is being
    // tested, which is exactly how this test misled us once already.
    assert.equal(
      process.env["ANTHROPIC_API_KEY"],
      undefined,
      "a module re-loaded .env and repopulated the key; the test is no longer isolated"
    );

    // Before the key is stored, AI is genuinely unconfigured.
    assert.equal(isAiConfigured(), false, "expected no key before one is saved");
    const before = checkSetup().find((r) => r.name === "AI features");
    assert.equal(before?.warning, true, "expected a warning while no key is set");

    setSetting("anthropic_api_key", "sk-ant-test-not-a-real-key");

    assert.equal(isAiConfigured(), true);

    const after = checkSetup().find((r) => r.name === "AI features");
    assert.ok(after, "the AI features check disappeared");
    assert.equal(
      after.warning,
      false,
      "check still warns that no AI key is set, though one is saved in the dashboard"
    );
  });
});
