import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getDataDir,
  getLegacyDataDir,
  migrateLegacyDataDir,
  readRenamedEnv,
  remapLegacyPath,
} from "../src/paths.js";

describe("legacy data directory migration", () => {
  let root = "";
  let legacyDir = "";
  let dataDir = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-paths-"));
    legacyDir = path.join(root, ".garmin");
    dataDir = path.join(root, ".trainbud");
  });

  afterEach(() => {
    if (fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports nothing to do when no legacy directory exists", () => {
    const result = migrateLegacyDataDir({ legacyDir, dataDir });
    assert.equal(result.migrated, false);
    assert.equal(result.reason, "no legacy directory");
    assert.equal(fs.existsSync(dataDir), false);
  });

  it("moves the whole legacy directory when the new one is absent", () => {
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "session.json"), '{"token":"abc"}');
    fs.writeFileSync(path.join(legacyDir, "cache.db"), "sqlite");

    const result = migrateLegacyDataDir({ legacyDir, dataDir });

    assert.equal(result.migrated, true);
    assert.equal(fs.readFileSync(path.join(dataDir, "session.json"), "utf8"), '{"token":"abc"}');
    assert.equal(fs.existsSync(path.join(dataDir, "cache.db")), true);
  });

  it("never overwrites a file that already exists in the new directory", () => {
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "session.json"), "old");
    fs.writeFileSync(path.join(dataDir, "session.json"), "current");
    fs.writeFileSync(path.join(legacyDir, "watch-setup.json"), "{}");

    const result = migrateLegacyDataDir({ legacyDir, dataDir });

    assert.equal(result.migrated, true);
    assert.deepEqual(result.movedEntries, ["watch-setup.json"]);
    // The live session must win over the pre-rename copy.
    assert.equal(fs.readFileSync(path.join(dataDir, "session.json"), "utf8"), "current");
  });

  it("is idempotent — a second run reports nothing left to move", () => {
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "session.json"), "x");

    migrateLegacyDataDir({ legacyDir, dataDir });
    fs.mkdirSync(legacyDir, { recursive: true });
    const second = migrateLegacyDataDir({ legacyDir, dataDir });

    assert.equal(second.migrated, false);
    assert.equal(second.reason, "already migrated");
  });

  it("copies nested directories, not just files", () => {
    fs.mkdirSync(path.join(legacyDir, "nested"), { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "nested", "inner.txt"), "deep");

    migrateLegacyDataDir({ legacyDir, dataDir });

    assert.equal(fs.readFileSync(path.join(dataDir, "nested", "inner.txt"), "utf8"), "deep");
  });
});

describe("legacy path remapping", () => {
  // An existing .env still says GARMIN_SESSION_PATH=.garmin/session.json, so
  // moving the directory alone let the app write state straight back into it.
  it("remaps a path inside the legacy directory to the new one", () => {
    assert.equal(
      remapLegacyPath(".garmin/session.json"),
      path.join(getDataDir(), "session.json")
    );
  });

  it("remaps nested legacy paths", () => {
    assert.equal(
      remapLegacyPath(".garmin/nested/cache.db"),
      path.join(getDataDir(), "nested", "cache.db")
    );
  });

  it("remaps an absolute path inside the legacy directory", () => {
    assert.equal(
      remapLegacyPath(path.join(getLegacyDataDir(), "cache.db")),
      path.join(getDataDir(), "cache.db")
    );
  });

  it("leaves paths already in the new directory alone", () => {
    const target = path.join(getDataDir(), "session.json");
    assert.equal(remapLegacyPath(target), target);
  });

  it("leaves unrelated paths alone", () => {
    const target = path.join(os.tmpdir(), "elsewhere", "session.json");
    assert.equal(remapLegacyPath(target), target);
  });

  it("does not remap a sibling directory with the legacy name as a prefix", () => {
    const target = `${getLegacyDataDir()}-backup${path.sep}session.json`;
    assert.equal(remapLegacyPath(target), target);
  });
});

describe("renamed environment variables", () => {
  const NEW = "TRAINBUD_TEST_KEY";
  const OLD = "GARMIN_TEST_KEY";

  afterEach(() => {
    delete process.env[NEW];
    delete process.env[OLD];
  });

  it("prefers the new name", () => {
    process.env[NEW] = "new";
    process.env[OLD] = "old";
    assert.deepEqual(readRenamedEnv(NEW, OLD), { value: "new", usedLegacy: false });
  });

  it("falls back to the legacy name and flags it", () => {
    process.env[OLD] = "old";
    assert.deepEqual(readRenamedEnv(NEW, OLD), { value: "old", usedLegacy: true });
  });

  it("treats an empty new value as unset so the legacy name still wins", () => {
    process.env[NEW] = "";
    process.env[OLD] = "old";
    assert.deepEqual(readRenamedEnv(NEW, OLD), { value: "old", usedLegacy: true });
  });

  it("returns undefined when neither is set", () => {
    assert.deepEqual(readRenamedEnv(NEW, OLD), { value: undefined, usedLegacy: false });
  });
});
