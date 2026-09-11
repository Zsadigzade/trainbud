import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeSpokenDay, raceLine, speakable } from "../src/speakDay.js";
import type { WatchSummary } from "../src/watchApi.js";

// The spoken summary is written for an ear, and the failures worth catching are
// all of the "sounded wrong" kind rather than the "threw an exception" kind:
// a symbol read out as a symbol, a missing measurement announced as a gap, a
// plural on a count of one.

function summary(overrides: Partial<WatchSummary> = {}): WatchSummary {
  const base = {
    daily_overview: { recovery: null, sleep_h: null, stress: null, vo2max: null },
    recovery: null,
    sleep: null,
    activity: null,
    stress: null,
    vo2max: null,
    heart_rate: null,
    findings: [],
    coverage: { days: 90, ready: true, throughDate: "2026-09-11", staleDays: 0 },
    week: null,
    race: null,
    prompts: [],
    ai_insight: null,
    ai_configured: false,
    states: {},
    display: {},
    alert: { level: "none" },
    budget: { exceeded: false },
    updated_at: "2026-09-11T00:00:00.000Z",
  } as unknown as WatchSummary;

  return { ...base, ...overrides };
}

describe("speakable", () => {
  it("turns a ratio into words, because 1.6x is read as 'one point six ex'", () => {
    assert.equal(speakable("load is 1.6x your average"), "load is 1.6 times your average");
  });

  it("expands the abbreviations a watch strip needs and an ear does not", () => {
    assert.equal(speakable("rhr 48 bpm"), "resting heart rate 48 beats per minute");
    assert.match(speakable("HRV is down"), /H R V/);
    assert.match(speakable("Load up 106 TRIMP"), /training load/);
  });

  it("reads a percentage as a word", () => {
    assert.equal(speakable("load up 32%"), "load up 32 percent");
  });

  it("turns leading signs into direction words", () => {
    assert.equal(speakable("rhr +4 today"), "resting heart rate up 4 today");
    assert.equal(speakable("weight -2 this month"), "weight down 2 this month");
  });

  it("leaves ordinary prose alone", () => {
    const plain = "Nothing stands out today.";
    assert.equal(speakable(plain), plain);
  });
});

describe("composeSpokenDay", () => {
  it("says so when there is not enough history, instead of reciting nulls", () => {
    const spoken = composeSpokenDay(
      summary({ coverage: { days: 3, ready: false, throughDate: "2026-09-11", staleDays: 0 } })
    );
    assert.match(spoken.text, /Not enough history/);
    assert.match(spoken.text, /3 days/);
    // Crucially it does not go on to read a summary of nothing.
    assert.equal(spoken.lines.length, 1);
  });

  it("leads with what stands out, because that is why anyone asked", () => {
    const spoken = composeSpokenDay(
      summary({
        findings: [
          { kind: "rhr", severity: "warn", headline: "Resting heart rate up 4 bpm" },
          { kind: "load", severity: "info", headline: "Load steady" },
        ],
      })
    );
    assert.match(spoken.lines[0] ?? "", /^What stands out/);
    // Informational findings are not "standing out" and must not be read as if
    // they were.
    assert.ok(!(spoken.lines[0] ?? "").includes("Load steady"));
  });

  it("says nothing stands out rather than staying silent", () => {
    const spoken = composeSpokenDay(summary());
    assert.match(spoken.text, /Nothing stands out today/);
  });

  it("omits a metric that has no measurement rather than announcing a gap", () => {
    const spoken = composeSpokenDay(
      summary({ recovery: { score: 62, label: "fair" }, sleep: null, stress: null })
    );
    assert.match(spoken.text, /Recovery 62/);
    assert.ok(!/sleep/i.test(spoken.text));
    assert.ok(!/unknown|null|undefined/i.test(spoken.text));
  });

  it("names the likely cause when nothing at all was measured", () => {
    const spoken = composeSpokenDay(summary());
    assert.match(spoken.text, /No measurements for today yet/);
    assert.match(spoken.text, /Sync your watch/);
  });

  it("uses the person's name when it knows one", () => {
    const spoken = composeSpokenDay(summary({ recovery: { score: 70, label: "good" } }), "Ziya");
    assert.match(spoken.text, /Ziya/);
  });

  it("never emits a stray symbol", () => {
    const spoken = composeSpokenDay(
      summary({
        recovery: { score: 41, label: "poor" },
        sleep: { hours: 5.4, score: 58, label: "short" },
        findings: [{ kind: "load", severity: "warn", headline: "Load 1.8x your average, +40%" }],
      })
    );
    assert.ok(!/[%+]/.test(spoken.text), `symbol survived: ${spoken.text}`);
    assert.ok(!/\d+x\b/.test(spoken.text), `ratio survived: ${spoken.text}`);
  });

  it("gets singulars right, which is the tell that a summary was generated", () => {
    const spoken = composeSpokenDay(
      summary({
        week: {
          sessions: 1,
          previous_sessions: 3,
          moving_minutes: 42,
          load_delta_pct: null,
          sleep_debt_h: null,
          sleep_habitual_h: null,
          sleep_consistency: "steady",
          forecast_ratio: null,
          forecast_verdict: "unknown",
        } as WatchSummary["week"],
      })
    );
    assert.match(spoken.text, /1 session this week/);
    assert.ok(!/1 sessions/.test(spoken.text));
  });

  it("stays quiet about a load change too small to act on", () => {
    const spoken = composeSpokenDay(
      summary({
        week: {
          sessions: 4,
          previous_sessions: 4,
          moving_minutes: 200,
          load_delta_pct: 2,
          sleep_debt_h: null,
          sleep_habitual_h: null,
          sleep_consistency: "steady",
          forecast_ratio: null,
          forecast_verdict: "on_track",
        } as WatchSummary["week"],
      })
    );
    assert.ok(!/training load/.test(spoken.text), spoken.text);
  });

  it("warns about a spike ahead, which is the whole point of a forecast", () => {
    const spoken = composeSpokenDay(
      summary({
        week: {
          sessions: 6,
          previous_sessions: 3,
          moving_minutes: 400,
          load_delta_pct: 80,
          sleep_debt_h: null,
          sleep_habitual_h: null,
          sleep_consistency: "steady",
          forecast_ratio: 1.6,
          forecast_verdict: "spike_ahead",
        } as WatchSummary["week"],
      })
    );
    assert.match(spoken.text, /load spikes/);
  });
});

describe("raceLine", () => {
  it("does not count down to today", () => {
    assert.equal(raceLine({ text: "", days_away: 0, phase: "race_week" }), "Race day is today.");
  });

  it("says tomorrow rather than '1 day'", () => {
    assert.equal(raceLine({ text: "", days_away: 1, phase: "race_week" }), "Your race is tomorrow.");
  });

  it("names the phase when there is one worth naming", () => {
    assert.match(raceLine({ text: "", days_away: 5, phase: "race_week" }), /race week/);
    assert.match(raceLine({ text: "", days_away: 12, phase: "taper" }), /taper/);
    assert.equal(raceLine({ text: "", days_away: 60, phase: "far_out" }), "60 days until your race.");
  });
});
