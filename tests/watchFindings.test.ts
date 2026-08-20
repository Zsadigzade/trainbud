import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildWatchSummaryFrom, toWatchFindings } from "../src/watchApi.js";
import { formatFindingsContext } from "../src/promptApi.js";
import type { Finding } from "../src/detect/findings.js";
import type { ContextEntry } from "../src/history/context.js";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    kind: "rhr_elevated",
    severity: "warn",
    date: "2026-08-19",
    headline: "Resting heart rate 5 bpm above your 28-day baseline, 3 days running",
    detail: "Easy training or a rest day is the low-risk call until it settles.",
    values: { deltaBpm: 5 },
    ...overrides,
  };
}

function entry(overrides: Partial<ContextEntry> = {}): ContextEntry {
  return {
    id: 1,
    kind: "race",
    text: "Baku Half Marathon",
    effectiveFrom: "2026-08-01",
    effectiveTo: "2026-10-12",
    createdAt: 0,
    ...overrides,
  };
}

const EMPTY_PARTS = {
  recovery: null,
  sleep: null,
  activity: null,
  stress: null,
  vo2max: null,
  heartRate: null,
  context: [],
  updatedAt: "2026-08-19T20:00:00.000Z",
};

describe("findings on the watch payload", () => {
  it("carries kind, severity and the pre-rendered headline", () => {
    const mapped = toWatchFindings([finding()]);

    assert.equal(mapped.length, 1);
    assert.equal(mapped[0]?.kind, "rhr_elevated");
    assert.equal(mapped[0]?.severity, "warn");
    assert.match(mapped[0]?.headline ?? "", /Resting heart rate/);
  });

  // The watch cannot wrap arbitrary text well -- a fixed-font activity name
  // already clips on a 390 px round screen -- so it gets the sentence, not the
  // numbers to build one, and the detail line is left on the server.
  it("does not ship the detail paragraph to the watch", () => {
    const mapped = toWatchFindings([finding()]) as unknown as Array<Record<string, unknown>>;

    assert.equal(mapped[0]?.detail, undefined);
    assert.equal(mapped[0]?.values, undefined);
  });

  it("keeps the order it was given", () => {
    const mapped = toWatchFindings([
      finding({ kind: "rhr_elevated" }),
      finding({ kind: "sleep_debt", severity: "notice" }),
    ]);

    assert.deepEqual(
      mapped.map((item) => item.kind),
      ["rhr_elevated", "sleep_debt"]
    );
  });

  it("adds findings and coverage to the summary without disturbing the metrics", () => {
    const summary = buildWatchSummaryFrom({
      ...EMPTY_PARTS,
      findings: [finding()],
      coverage: { days: 73, ready: true },
    });

    assert.equal(summary.findings.length, 1);
    assert.equal(summary.coverage.days, 73);
    assert.equal(summary.coverage.ready, true);
    // The 1.2.1 contract is untouched.
    assert.equal(summary.daily_overview.recovery, null);
    assert.equal(summary.updated_at, "2026-08-19T20:00:00.000Z");
  });

  it("reports an empty store as not ready rather than as nothing wrong", () => {
    const summary = buildWatchSummaryFrom({
      ...EMPTY_PARTS,
      findings: [],
      coverage: { days: 0, ready: false },
    });

    assert.deepEqual(summary.findings, []);
    assert.equal(summary.coverage.ready, false);
  });
});

describe("the context the model is given", () => {
  it("names every finding and every active context entry", () => {
    const text = formatFindingsContext(
      { findings: [finding()], coverage: { days: 73, ready: true } },
      [entry(), entry({ id: 2, kind: "injury", text: "Left achilles", effectiveTo: null })]
    );

    assert.match(text, /Resting heart rate 5 bpm/);
    assert.match(text, /Baku Half Marathon/);
    assert.match(text, /Left achilles/);
  });

  it("says nothing stands out when the store is ready and quiet", () => {
    const text = formatFindingsContext(
      { findings: [], coverage: { days: 73, ready: true } },
      []
    );

    assert.match(text, /nothing stands out/i);
    assert.doesNotMatch(text, /still gathering/i);
  });

  // Otherwise the model writes a confident daily sentence out of no data.
  it("says it is still gathering when coverage is not ready", () => {
    const text = formatFindingsContext(
      { findings: [], coverage: { days: 4, ready: false } },
      []
    );

    assert.match(text, /still gathering/i);
    assert.match(text, /4/);
  });

  it("mentions when there is no context on record at all", () => {
    const text = formatFindingsContext(
      { findings: [finding()], coverage: { days: 73, ready: true } },
      []
    );

    assert.match(text, /nothing on record/i);
  });
});

describe("prompts on the watch payload", () => {
  it("ships five prompts drawn from what fired", () => {
    const summary = buildWatchSummaryFrom({
      ...EMPTY_PARTS,
      findings: [finding()],
      coverage: { days: 73, ready: true },
    });

    assert.equal(summary.prompts.length, 5);
    assert.match(summary.prompts[0] ?? "", /resting HR/i);
  });

  it("ships cold-start prompts before there is enough history", () => {
    const summary = buildWatchSummaryFrom({
      ...EMPTY_PARTS,
      findings: [],
      coverage: { days: 2, ready: false },
    });

    assert.equal(summary.prompts.length, 5);
    assert.match(summary.prompts[0] ?? "", /how much data/i);
  });
});
