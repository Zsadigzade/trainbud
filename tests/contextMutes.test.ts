import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { DateTime } from "luxon";
import { activeContext, addContextEntry, allContext } from "../src/history/context.js";
import { closeHistoryDb, getHistoryDb, openHistoryDb } from "../src/history/store.js";
import { parseMuteTargets } from "../src/detect/mute.js";

describe("a context entry that mutes", () => {
  let directory: string;
  let index = 0;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-mutes-"));
  });

  beforeEach(() => {
    closeHistoryDb();
    index += 1;
    openHistoryDb(path.join(directory, `mutes-${index}.db`));
  });

  after(() => {
    closeHistoryDb();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("round-trips the muted kinds", () => {
    addContextEntry("note", "Travelling", { mutes: ["rhr_elevated", "sleep_debt"] });

    assert.deepEqual(activeContext(DateTime.local().toISODate() ?? "")[0]?.mutes, [
      "rhr_elevated",
      "sleep_debt",
    ]);
  });

  it("reads an entry that mutes nothing as an empty list, never undefined", () => {
    // Every consumer iterates this. A null would make muting a runtime error on
    // the entries that are most common.
    addContextEntry("goal", "Sub-40 10k");

    assert.deepEqual(allContext()[0]?.mutes, []);
  });

  it("expires a mute on its own after a fortnight when no end date is given", () => {
    // Forgetting has to be the safe outcome: an open-ended mute is a permanent
    // blind spot nobody remembers creating.
    const entry = addContextEntry("note", "Travelling", {
      effectiveFrom: "2026-09-12",
      mutes: ["rhr_elevated"],
    });

    assert.equal(entry.effectiveTo, "2026-09-26");
  });

  it("leaves a plain record open-ended", () => {
    const entry = addContextEntry("injury", "Left achilles", { effectiveFrom: "2026-09-12" });

    assert.equal(entry.effectiveTo, null);
  });

  it("keeps an end date the user gave", () => {
    const entry = addContextEntry("note", "Altitude camp", {
      effectiveFrom: "2026-09-12",
      effectiveTo: "2026-09-19",
      mutes: ["*"],
    });

    assert.equal(entry.effectiveTo, "2026-09-19");
  });

  it("survives a row whose mutes column is not JSON", () => {
    // Never let one bad row take the findings down with it.
    addContextEntry("note", "Travelling", { mutes: ["rhr_elevated"] });
    getHistoryDb().prepare("UPDATE context_entry SET mutes = ?").run("not json at all");

    assert.deepEqual(allContext()[0]?.mutes, []);
  });
});

describe("the column that had to be added to a database already in use", () => {
  let directory: string;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-migrate-"));
  });

  after(() => {
    closeHistoryDb();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("adds mutes to a context_entry table created before it existed", () => {
    // The only database that matters is the one that has been collecting this
    // user's history for months, and `CREATE TABLE IF NOT EXISTS` never reaches
    // it. Built here exactly as the old schema built it, then opened normally.
    const file = path.join(directory, "old.db");
    const old = new Database(file);
    old.exec(`CREATE TABLE context_entry (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      kind           TEXT    NOT NULL,
      text           TEXT    NOT NULL,
      effective_from TEXT    NOT NULL,
      effective_to   TEXT,
      created_at     INTEGER NOT NULL
    );`);
    old.prepare(
      `INSERT INTO context_entry (kind, text, effective_from, effective_to, created_at)
       VALUES ('race', 'Baku Half', '2026-08-01', '2026-10-12', 0)`
    ).run();
    old.close();

    closeHistoryDb();
    openHistoryDb(file);

    const entries = allContext();
    assert.equal(entries.length, 1, "the row that was already there must survive");
    assert.equal(entries[0]?.text, "Baku Half");
    assert.deepEqual(entries[0]?.mutes, []);

    // And opening it again must not fail on a column that now exists.
    closeHistoryDb();
    openHistoryDb(file);
    assert.equal(allContext().length, 1);
  });
});

describe("parseMuteTargets", () => {
  it("accepts an array, as an MCP client sends it", () => {
    assert.deepEqual(parseMuteTargets(["rhr_elevated"]), ["rhr_elevated"]);
  });

  it("accepts a comma-joined string, as the dashboard form sends it", () => {
    assert.deepEqual(parseMuteTargets("rhr_elevated, sleep_debt"), [
      "rhr_elevated",
      "sleep_debt",
    ]);
  });

  it("reads nothing at all as nothing to mute", () => {
    assert.equal(parseMuteTargets(""), undefined);
    assert.equal(parseMuteTargets(undefined), undefined);
    assert.equal(parseMuteTargets(null), undefined);
  });

  it("accepts the wildcard", () => {
    assert.deepEqual(parseMuteTargets("*"), ["*"]);
  });

  it("refuses a kind that does not exist, rather than silently muting nothing", () => {
    // A mute that quietly did nothing would be found out by the alarm it failed
    // to stop, which is the worst moment to learn about a typo.
    assert.throws(() => parseMuteTargets("resting_heart_rate"), /Cannot mute/);
  });

  it("names the valid choices in the error", () => {
    assert.throws(() => parseMuteTargets("nonsense"), /rhr_elevated/);
  });
});
