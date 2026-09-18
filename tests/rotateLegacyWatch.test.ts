import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

// `rotate api-key` replaces the master key, which is the only credential a watch
// paired before 0.5.2 has. The sighting that `doctor` and `devices list` read
// says "a watch is authenticating with the master key" — and the instant the key
// is replaced that is false, because the key it was using no longer exists.
//
// Nothing cleared it. The warning stayed live for its full week about a
// credential already revoked, and a second rotation inside that week announced
// "A WATCH JUST STOPPED WORKING" about a watch that stopped working the first
// time.
//
// rotateApiKey itself is not called here on purpose: it writes `.env` at a path
// fixed to the project root, with no override, so a test that called it would
// rewrite the developer's own file. This covers the half that touches app.db.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-rotate-"));
const previousCachePath = process.env.TRAINBUD_CACHE_PATH;

describe("rotating the API key forgets the watch it just cut off", () => {
  let appDb: typeof import("../src/appDb.js");
  let rotate: typeof import("../src/rotate.js");

  before(async () => {
    process.env.TRAINBUD_CACHE_PATH = path.join(tempDir, "cache.db");
    appDb = await import("../src/appDb.js");
    rotate = await import("../src/rotate.js");
  });

  after(() => {
    appDb.closeAppDb();
    if (previousCachePath === undefined) {
      delete process.env.TRAINBUD_CACHE_PATH;
    } else {
      process.env.TRAINBUD_CACHE_PATH = previousCachePath;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Windows can still hold the database handle; see securityHeaders.test.ts.
    }
  });

  it("reports the watch that was using the old key", () => {
    appDb.clearMasterKeyWatch();
    appDb.recordMasterKeyWatch("2.1.0", Math.floor(Date.now() / 1000) - 600);

    const lines = rotate.reportAndClearLegacyWatch().join("\n");

    assert.match(lines, /A WATCH JUST STOPPED WORKING/);
    assert.match(lines, /build 2\.1\.0/);
  });

  it("clears the record, so the next reader is not warned about a dead credential", () => {
    appDb.clearMasterKeyWatch();
    appDb.recordMasterKeyWatch("2.1.0", Math.floor(Date.now() / 1000) - 600);

    rotate.reportAndClearLegacyWatch();

    assert.equal(appDb.getMasterKeyWatch(), null);
    assert.equal(appDb.isMasterKeyWatchActive(), false);
  });

  it("does not claim a second time that a watch just stopped working", () => {
    appDb.clearMasterKeyWatch();
    appDb.recordMasterKeyWatch("2.1.0", Math.floor(Date.now() / 1000) - 600);

    const first = rotate.reportAndClearLegacyWatch().join("\n");
    const second = rotate.reportAndClearLegacyWatch().join("\n");

    assert.match(first, /A WATCH JUST STOPPED WORKING/);
    assert.doesNotMatch(second, /JUST STOPPED WORKING/);
    assert.match(second, /No watch has used this key to sync in the last week/);
  });

  it("says nothing alarming when no watch was on the master key", () => {
    appDb.clearMasterKeyWatch();

    const lines = rotate.reportAndClearLegacyWatch().join("\n");

    assert.doesNotMatch(lines, /JUST STOPPED WORKING/);
    assert.match(lines, /No watch has used this key to sync in the last week/);
  });

  it("ignores a sighting old enough to have expired", () => {
    appDb.clearMasterKeyWatch();
    // Eight days: past the staleness window, so that watch has already stopped
    // using this key by some other means and rotation is not what broke it.
    appDb.recordMasterKeyWatch("2.1.0", Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60);

    const lines = rotate.reportAndClearLegacyWatch().join("\n");

    assert.doesNotMatch(lines, /JUST STOPPED WORKING/);
    // Cleared regardless, so a stale row cannot linger.
    assert.equal(appDb.getMasterKeyWatch(), null);
  });
});
