import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  activeContext,
  addContextEntry,
  closeContextEntry,
  logSubjective,
  subjectiveSeries,
} from "../src/history/context.js";
import { closeHistoryDb, openHistoryDb } from "../src/history/store.js";

describe("user context", () => {
  let directory: string;
  let index = 0;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-context-"));
  });

  beforeEach(() => {
    closeHistoryDb();
    index += 1;
    openHistoryDb(path.join(directory, `context-${index}.db`));
  });

  after(() => {
    closeHistoryDb();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("round-trips an entry", () => {
    const entry = addContextEntry("goal", "Sub-1:45 half marathon", {
      effectiveFrom: "2026-08-01",
    });

    assert.equal(entry.kind, "goal");
    assert.equal(entry.text, "Sub-1:45 half marathon");
    assert.ok(entry.id > 0);

    const active = activeContext("2026-08-19");
    assert.equal(active.length, 1);
    assert.equal(active[0]?.text, "Sub-1:45 half marathon");
  });

  it("treats an entry with no end date as still true", () => {
    addContextEntry("goal", "Run a half", { effectiveFrom: "2026-01-01" });

    assert.equal(activeContext("2027-05-05").length, 1);
  });

  it("excludes an entry that has not started yet", () => {
    addContextEntry("race", "Baku Marathon", { effectiveFrom: "2026-10-12" });

    assert.equal(activeContext("2026-08-19").length, 0);
    assert.equal(activeContext("2026-10-12").length, 1);
  });

  it("excludes an entry that already ended", () => {
    addContextEntry("injury", "Left achilles", {
      effectiveFrom: "2026-06-01",
      effectiveTo: "2026-07-01",
    });

    assert.equal(activeContext("2026-08-19").length, 0);
  });

  // An injury heals and a race happens, but "how did the last build go, when the
  // achilles was bad" is exactly the question this layer exists to answer -- so
  // closing an entry must not erase that it was ever true.
  it("keeps a closed entry true for the dates it covered", () => {
    const entry = addContextEntry("injury", "Left achilles", {
      effectiveFrom: "2026-06-01",
    });

    assert.equal(closeContextEntry(entry.id, "2026-07-01"), true);

    assert.equal(activeContext("2026-08-19").length, 0);
    assert.equal(activeContext("2026-06-15").length, 1);
  });

  it("reports a close of an entry that does not exist", () => {
    assert.equal(closeContextEntry(9999, "2026-07-01"), false);
  });

  it("returns entries with the newest first", () => {
    addContextEntry("goal", "older", { effectiveFrom: "2026-01-01" });
    addContextEntry("injury", "newer", { effectiveFrom: "2026-08-01" });

    const active = activeContext("2026-08-19");
    assert.equal(active[0]?.text, "newer");
    assert.equal(active[1]?.text, "older");
  });

  it("rejects an empty text rather than storing a blank record", () => {
    assert.throws(() => addContextEntry("goal", "   "), /text/i);
  });
});

describe("subjective entries", () => {
  let directory: string;
  let index = 0;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-subjective-"));
  });

  beforeEach(() => {
    closeHistoryDb();
    index += 1;
    openHistoryDb(path.join(directory, `subjective-${index}.db`));
  });

  after(() => {
    closeHistoryDb();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("round-trips a rating with its note", () => {
    logSubjective("2026-08-19", "rpe", 8, "felt harder than the pace suggests");

    const series = subjectiveSeries("rpe", "2026-08-01", "2026-08-31");
    assert.equal(series.length, 1);
    assert.equal(series[0]?.value, 8);
    assert.equal(series[0]?.note, "felt harder than the pace suggests");
  });

  // One rating per day per kind: a correction should replace, not accumulate.
  it("upserts on the day and kind", () => {
    logSubjective("2026-08-19", "rpe", 8);
    logSubjective("2026-08-19", "rpe", 6);

    const series = subjectiveSeries("rpe", "2026-08-19", "2026-08-19");
    assert.equal(series.length, 1);
    assert.equal(series[0]?.value, 6);
  });

  it("keeps the kinds apart", () => {
    logSubjective("2026-08-19", "rpe", 8);
    logSubjective("2026-08-19", "soreness", 3);

    assert.equal(subjectiveSeries("rpe", "2026-08-19", "2026-08-19").length, 1);
    assert.equal(subjectiveSeries("soreness", "2026-08-19", "2026-08-19")[0]?.value, 3);
  });

  it("returns a series in ascending date order and clips to the range", () => {
    logSubjective("2026-08-17", "rpe", 5);
    logSubjective("2026-08-19", "rpe", 8);
    logSubjective("2026-07-01", "rpe", 4);

    const series = subjectiveSeries("rpe", "2026-08-01", "2026-08-31");
    assert.deepEqual(
      series.map((entry) => entry.date),
      ["2026-08-17", "2026-08-19"]
    );
  });

  // The scale is the thing that makes these comparable across days. A 0 or a 12
  // is a typo, and storing it silently poisons every average built on it.
  it("rejects a rating outside the scale", () => {
    assert.throws(() => logSubjective("2026-08-19", "rpe", 0), /1 and 10/);
    assert.throws(() => logSubjective("2026-08-19", "rpe", 11), /1 and 10/);
    assert.throws(() => logSubjective("2026-08-19", "rpe", Number.NaN), /1 and 10/);
  });
});
