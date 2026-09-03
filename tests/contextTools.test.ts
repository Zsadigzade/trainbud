import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { toolRegistry, toolSchemas } from "../src/tools/index.js";
import {
  getUserContext,
  logSubjectiveEntry,
  rememberContext,
} from "../src/tools/context.js";
import { getFindings } from "../src/tools/findings.js";
import { closeHistoryDb, openHistoryDb } from "../src/history/store.js";

describe("tool registry", () => {
  it("registers the nine Garmin tools plus findings, week review and context", () => {
    assert.deepEqual(
      toolRegistry.map((tool) => tool.name),
      [
        "get_latest_activity",
        "get_activities_range",
        "get_sleep_data",
        "get_heart_rate_trends",
        "get_recovery_status",
        "get_body_composition",
        "get_stress_levels",
        "get_vo2_max_trends",
        "get_training_insights",
        "get_findings",
        "get_week_review",
        "remember_context",
        "get_user_context",
        "log_subjective",
      ]
    );
  });

  // A tool in the registry with no schema is registered with MCP as taking no
  // arguments, so it silently ignores everything the model sends it.
  it("has a schema for every registered tool", () => {
    for (const tool of toolRegistry) {
      assert.ok(
        tool.name in toolSchemas,
        `${tool.name} is registered but has no entry in toolSchemas`
      );
    }
  });
});

describe("context tools", () => {
  let directory: string;
  let index = 0;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-ctx-tools-"));
  });

  beforeEach(() => {
    closeHistoryDb();
    index += 1;
    openHistoryDb(path.join(directory, `tools-${index}.db`));
  });

  after(() => {
    closeHistoryDb();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("records a race with its date and says what it did", async () => {
    const result = await rememberContext({
      kind: "race",
      text: "Baku Half Marathon",
      effective_from: "2026-08-01",
      effective_to: "2026-10-12",
    });

    assert.equal(result.data.entry.kind, "race");
    assert.equal(result.data.entry.effectiveTo, "2026-10-12");
    assert.match(result.text, /Baku Half Marathon/);
  });

  it("names the valid kinds when given a bad one", async () => {
    await assert.rejects(
      () => rememberContext({ kind: "workout", text: "x" }),
      /goal, race, injury, note/
    );
  });

  it("rejects an unparseable date rather than storing it", async () => {
    await assert.rejects(
      () => rememberContext({ kind: "goal", text: "x", effective_from: "next tuesday" }),
      /ISO date/
    );
  });

  it("lists what is on record, and says so when nothing is", async () => {
    const empty = await getUserContext({ on_date: "2026-08-19" });
    assert.equal(empty.data.entries.length, 0);
    assert.match(empty.text, /remember_context/);

    await rememberContext({ kind: "injury", text: "Left achilles", effective_from: "2026-08-01" });

    const listed = await getUserContext({ on_date: "2026-08-19" });
    assert.equal(listed.data.entries.length, 1);
    assert.match(listed.text, /Left achilles/);
  });

  it("records a rating and returns the recent series", async () => {
    await logSubjectiveEntry({ kind: "rpe", value: 8, date: "2026-08-19", note: "brutal" });

    const result = await logSubjectiveEntry({ kind: "rpe", value: 5, date: "2026-08-20" });

    assert.equal(result.data.value, 5);
    assert.equal(result.data.recent.length, 2);
    assert.match(result.text, /rpe 5\/10/);
  });

  it("rejects a rating off the scale", async () => {
    await assert.rejects(
      () => logSubjectiveEntry({ kind: "rpe", value: 11, date: "2026-08-19" }),
      /1 and 10/
    );
  });

  it("rejects an unknown rating kind", async () => {
    await assert.rejects(
      () => logSubjectiveEntry({ kind: "vibes", value: 5 }),
      /rpe, soreness, mood/
    );
  });
});

describe("findings tool", () => {
  let directory: string;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-findings-tool-"));
    closeHistoryDb();
    openHistoryDb(path.join(directory, "findings.db"));
  });

  after(() => {
    closeHistoryDb();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  // The distinction the whole cold-start design rests on: an empty store must
  // not read as a clean bill of health.
  it("reports not-ready on an empty store rather than nothing-found", async () => {
    const result = await getFindings();

    assert.equal(result.data.coverage.ready, false);
    assert.deepEqual(result.data.findings, []);
    assert.match(result.text, /Still gathering data/);
    assert.doesNotMatch(result.text, /Nothing stands out/);
  });
});
