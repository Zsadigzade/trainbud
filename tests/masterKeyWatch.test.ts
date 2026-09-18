import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

// A watch paired before 0.5.2 carries the master key rather than a token of its
// own. Nothing in the product could see it: `device_tokens` is empty, so
// `trainbud devices list` said "No paired watches" while a watch sat on the
// wrist polling /api/watch every few seconds. An absence was standing in for a
// credential that cannot be revoked, and the only instruction anywhere was to
// infer it from an empty list.
//
// These tests pin the other half: the server notices a watch authenticating
// with the master key and writes down that it happened, so the warning can name
// the thing instead of asking the reader to deduce it.
//
// appDb resolves its file from appConfig.cachePath at module load, so the
// pointer has to move before the module is imported.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-masterkey-"));
const previousCachePath = process.env.TRAINBUD_CACHE_PATH;

describe("a watch on the master key", () => {
  let appDb: typeof import("../src/appDb.js");

  before(async () => {
    process.env.TRAINBUD_CACHE_PATH = path.join(tempDir, "cache.db");
    appDb = await import("../src/appDb.js");
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

  it("reports nothing before one has ever been seen", () => {
    appDb.clearMasterKeyWatch();
    assert.equal(appDb.getMasterKeyWatch(), null);
  });

  it("records the sighting and the build the watch reported", () => {
    appDb.clearMasterKeyWatch();
    const now = 1_800_000_000;

    appDb.recordMasterKeyWatch("2.1.0", now);

    const seen = appDb.getMasterKeyWatch();
    assert.deepEqual(seen, { last_seen_at: now, build: "2.1.0" });
  });

  it("keeps a build it already knows when a later request omits one", () => {
    appDb.clearMasterKeyWatch();
    appDb.recordMasterKeyWatch("2.1.0", 1_800_000_000);

    // /api/mute and /api/ask carry no build parameter. Letting them blank the
    // field would mean the warning could name a version one minute and not the
    // next, purely from which endpoint the watch happened to call.
    appDb.recordMasterKeyWatch(null, 1_800_000_500);

    assert.deepEqual(appDb.getMasterKeyWatch(), {
      last_seen_at: 1_800_000_500,
      build: "2.1.0",
    });
  });

  it("takes a new build over the one it held", () => {
    appDb.clearMasterKeyWatch();
    appDb.recordMasterKeyWatch("2.0.3", 1_800_000_000);
    appDb.recordMasterKeyWatch("2.1.0", 1_800_000_500);

    assert.equal(appDb.getMasterKeyWatch()?.build, "2.1.0");
  });

  it("throttles further writes for a minute, like a device token", () => {
    appDb.clearMasterKeyWatch();
    const now = 1_800_000_000;

    appDb.recordMasterKeyWatch("2.1.0", now);
    // The watch polls every few seconds. Without the throttle this is a write
    // per request for a column nobody reads more precisely than "today".
    appDb.recordMasterKeyWatch("2.1.0", now + 5);
    assert.equal(appDb.getMasterKeyWatch()?.last_seen_at, now);

    appDb.recordMasterKeyWatch("2.1.0", now + 61);
    assert.equal(appDb.getMasterKeyWatch()?.last_seen_at, now + 61);
  });

  it("stores a build only when it is one, not any query string that arrives", () => {
    appDb.clearMasterKeyWatch();
    appDb.recordMasterKeyWatch("2.1.0; rm -rf /", 1_800_000_000);
    // `build` comes off a public query string. It is displayed in a warning, so
    // anything that is not a plain version is dropped rather than echoed.
    assert.equal(appDb.getMasterKeyWatch()?.build, null);

    appDb.recordMasterKeyWatch("x".repeat(40), 1_800_000_100);
    assert.equal(appDb.getMasterKeyWatch()?.build, null);
  });

  it("counts as active while it is still being seen, and stale once it stops", () => {
    appDb.clearMasterKeyWatch();
    const now = 1_800_000_000;
    appDb.recordMasterKeyWatch("2.1.0", now);

    // Re-pairing is what fixes this, and a re-paired watch simply stops sending
    // the master key. There is no event to catch, so the warning has to expire
    // on its own rather than needing something to come along and clear it.
    assert.equal(appDb.isMasterKeyWatchActive(now + 60), true);
    assert.equal(appDb.isMasterKeyWatchActive(now + 6 * 24 * 60 * 60), true);
    assert.equal(appDb.isMasterKeyWatchActive(now + 8 * 24 * 60 * 60), false);
  });

  it("is not active when none was ever recorded", () => {
    appDb.clearMasterKeyWatch();
    assert.equal(appDb.isMasterKeyWatchActive(1_800_000_000), false);
  });

  it("stops being recorded once that watch pairs properly", () => {
    // Nothing clears the record on a pairing -- the sighting is what stops.
    // This pins the shape the CLI depends on: a device row and a stale master
    // key sighting can coexist, and the list has to be able to tell them apart.
    appDb.clearMasterKeyWatch();
    appDb.revokeAllDeviceTokens();
    appDb.recordMasterKeyWatch("2.1.0", 1_800_000_000);
    appDb.createDeviceToken("watch-repaired");

    assert.equal(appDb.listDeviceTokens().length, 1);
    assert.equal(appDb.isMasterKeyWatchActive(1_800_000_000 + 8 * 24 * 60 * 60), false);
  });
});
