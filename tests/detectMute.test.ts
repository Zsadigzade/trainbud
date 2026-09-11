import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { applyMutes } from "../src/detect/mute.js";
import type { Finding } from "../src/detect/findings.js";
import type { ContextEntry } from "../src/history/context.js";

const NOW = DateTime.fromISO("2026-09-12T20:00:00", { zone: "utc" });

function finding(kind: Finding["kind"], date: string): Finding {
  return {
    kind,
    severity: "notice",
    date,
    headline: `${kind} happened`,
    detail: "detail",
    values: {},
  };
}

function entry(partial: Partial<ContextEntry> = {}): ContextEntry {
  return {
    id: 1,
    kind: "note",
    text: "travelling",
    effectiveFrom: "2026-09-10",
    effectiveTo: null,
    createdAt: 0,
    mutes: [],
    ...partial,
  };
}

describe("applyMutes", () => {
  it("passes every finding through when nothing is recorded", () => {
    const findings = [finding("rhr_elevated", "2026-09-12")];

    const result = applyMutes(findings, [], NOW);

    assert.deepEqual(result.findings, findings);
    assert.deepEqual(result.muted, []);
  });

  it("passes findings through for an entry that mutes nothing", () => {
    // A goal or a healed injury is a record, not an instruction. Recording
    // something must never quieten anything on its own -- that is the blanket
    // mute this design exists to avoid.
    const findings = [finding("rhr_elevated", "2026-09-12")];

    const result = applyMutes(findings, [entry({ kind: "goal", mutes: [] })], NOW);

    assert.equal(result.findings.length, 1);
    assert.equal(result.muted.length, 0);
  });

  it("mutes a finding whose kind an active entry names", () => {
    const result = applyMutes(
      [finding("rhr_elevated", "2026-09-12"), finding("sleep_debt", "2026-09-12")],
      [entry({ mutes: ["rhr_elevated"] })],
      NOW
    );

    assert.deepEqual(
      result.findings.map((each) => each.kind),
      ["sleep_debt"]
    );
    assert.deepEqual(
      result.muted.map((each) => each.kind),
      ["rhr_elevated"]
    );
    assert.deepEqual(result.muted[0]?.mutedBy, { id: 1, kind: "note", text: "travelling" });
  });

  it("keeps the muted finding's own numbers, so nothing is lost", () => {
    const original = finding("rhr_elevated", "2026-09-12");
    original.values = { deltaBpm: 4 };

    const result = applyMutes([original], [entry({ mutes: ["rhr_elevated"] })], NOW);

    assert.deepEqual(result.muted[0]?.values, { deltaBpm: 4 });
    assert.equal(result.muted[0]?.headline, original.headline);
  });

  it("mutes every kind for a wildcard entry", () => {
    const result = applyMutes(
      [finding("rhr_elevated", "2026-09-12"), finding("load_ratio_high", "2026-09-12")],
      [entry({ mutes: ["*"] })],
      NOW
    );

    assert.deepEqual(result.findings, []);
    assert.equal(result.muted.length, 2);
  });

  it("mutes a finding dated before the entry began, while the entry is true today", () => {
    // Garmin finalises a sleep score hours after waking, so the finding a user
    // is looking at when they reach for the mute is routinely dated yesterday.
    // Matching only on the finding's own date would leave the alarm they just
    // silenced still ringing, which is the exact complaint this answers.
    const result = applyMutes(
      [finding("rhr_elevated", "2026-09-11")],
      [entry({ effectiveFrom: "2026-09-12", effectiveTo: "2026-09-26", mutes: ["rhr_elevated"] })],
      NOW
    );

    assert.equal(result.findings.length, 0);
    assert.equal(result.muted.length, 1);
  });

  it("mutes a finding dated inside a window that has since closed", () => {
    const result = applyMutes(
      [finding("rhr_elevated", "2026-09-01")],
      [entry({ effectiveFrom: "2026-08-28", effectiveTo: "2026-09-05", mutes: ["rhr_elevated"] })],
      NOW
    );

    assert.equal(result.muted.length, 1);
  });

  it("does not mute once the entry has expired and the finding is current", () => {
    // The whole point of a default end date: forgetting brings the alarm back.
    const result = applyMutes(
      [finding("rhr_elevated", "2026-09-12")],
      [entry({ effectiveFrom: "2026-08-01", effectiveTo: "2026-08-15", mutes: ["rhr_elevated"] })],
      NOW
    );

    assert.equal(result.findings.length, 1);
    assert.equal(result.muted.length, 0);
  });

  it("does not mute for an entry that has not started yet", () => {
    const result = applyMutes(
      [finding("load_ratio_high", "2026-09-12")],
      [entry({ effectiveFrom: "2026-10-12", effectiveTo: null, mutes: ["load_ratio_high"] })],
      NOW
    );

    assert.equal(result.findings.length, 1);
    assert.equal(result.muted.length, 0);
  });

  it("ignores a mute string that names no finding kind", () => {
    // A row written by a newer build, or a typo that reached the database. It
    // must mute nothing rather than everything.
    const result = applyMutes(
      [finding("rhr_elevated", "2026-09-12")],
      [entry({ mutes: ["resting_heart_rate", ""] })],
      NOW
    );

    assert.equal(result.findings.length, 1);
    assert.equal(result.muted.length, 0);
  });

  it("credits the first matching entry when two of them would mute", () => {
    const result = applyMutes(
      [finding("rhr_elevated", "2026-09-12")],
      [
        entry({ id: 7, text: "illness", mutes: ["*"] }),
        entry({ id: 2, text: "travelling", mutes: ["rhr_elevated"] }),
      ],
      NOW
    );

    assert.equal(result.muted[0]?.mutedBy.id, 7);
  });

  it("leaves the order of the findings it keeps untouched", () => {
    const result = applyMutes(
      [
        finding("rhr_elevated", "2026-09-12"),
        finding("sleep_debt", "2026-09-12"),
        finding("hrv_trend_break", "2026-09-12"),
      ],
      [entry({ mutes: ["sleep_debt"] })],
      NOW
    );

    assert.deepEqual(
      result.findings.map((each) => each.kind),
      ["rhr_elevated", "hrv_trend_break"]
    );
  });
});
