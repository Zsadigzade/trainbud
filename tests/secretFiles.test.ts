import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeSecretFile } from "../src/utils/secretFile.js";

// Windows does not carry POSIX permission bits, so the assertion that matters
// only means anything on Linux and macOS -- which is what CI runs.
const posix = process.platform !== "win32";

describe("secret files on disk", () => {
  it("writes credentials readable only by their owner", (t) => {
    if (!posix) {
      t.skip("POSIX permission bits are not meaningful on Windows");
      return;
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-secret-"));
    const target = path.join(dir, "session.json");

    // .env holds the Connect password and the API key; session.json holds live
    // OAuth tokens. Written with the default mode, both land as 0644 -- any
    // other account on the machine can read them.
    writeSecretFile(target, JSON.stringify({ oauth1: "token" }));

    const mode = fs.statSync(target).mode & 0o777;
    assert.equal(mode, 0o600, `expected 0600, got 0${mode.toString(8)}`);
  });

  it("tightens an existing file that was created world-readable", (t) => {
    if (!posix) {
      t.skip("POSIX permission bits are not meaningful on Windows");
      return;
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-secret-"));
    const target = path.join(dir, ".env");

    // An .env written by an older version keeps its 0644 -- writeFileSync's
    // mode applies at creation only, so a rewrite alone would leave it open.
    fs.writeFileSync(target, "GARMIN_PASSWORD=old", { mode: 0o644 });
    writeSecretFile(target, "GARMIN_PASSWORD=new");

    const mode = fs.statSync(target).mode & 0o777;
    assert.equal(mode, 0o600, `expected 0600, got 0${mode.toString(8)}`);
    assert.equal(fs.readFileSync(target, "utf8"), "GARMIN_PASSWORD=new");
  });
});
