import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { formatFindingsContext, formatHealthContext } from "../src/promptApi.js";
import { runDetectors } from "../src/detect/index.js";
import type { DetectorInput } from "../src/detect/findings.js";
import type { MetricKind } from "../src/history/schema.js";
import type { WatchSummary } from "../src/watchApi.js";

// Reported as: "the AI gives back results but says it has no access to the
// user's data".
//
// It was not the AI. The live Garmin call was failing, so every field of the
// health snapshot was null — and the section header was printed regardless, so
// the model received "Current health snapshot:" with nothing under it and
// correctly reported having no data. Meanwhile the stored record ended 13 days
// earlier and the findings context said "nothing stands out", which is a claim
// about days that were never recorded.

const NOW = DateTime.fromISO("2026-09-03T12:00:00", { zone: "utc" });

function inputWithSeriesEnding(lastDate: string, count: number): DetectorInput {
  const end = DateTime.fromISO(lastDate);
  const points = Array.from({ length: count }, (_, index) => ({
    date: end.minus({ days: count - 1 - index }).toISODate() ?? "",
    value: 55,
  }));
  return {
    now: NOW,
    series: (_kind: MetricKind, days: number) => points.slice(-days),
    activities: () => [],
  };
}

const EMPTY_SUMMARY = {
  daily_overview: { recovery: null, sleep_h: null, stress: null, vo2max: null },
  recovery: null,
  sleep: null,
  activity: null,
  stress: null,
  vo2max: null,
  heart_rate: null,
  findings: [],
  coverage: { days: 0, ready: false, throughDate: null, staleDays: 0 },
  week: null,
  race: null,
  prompts: [],
  ai_insight: null,
  ai_configured: true,
  updated_at: "2026-09-03T12:00:00.000Z",
} as unknown as WatchSummary;

describe("coverage knows how old the record is", () => {
  it("is not ready when the record stops weeks ago, however many days it holds", () => {
    // 74 days of history ending 2026-08-21, asked on 2026-09-03.
    const result = runDetectors(inputWithSeriesEnding("2026-08-21", 74));

    assert.equal(result.coverage.days, 74);
    assert.equal(result.coverage.throughDate, "2026-08-21");
    assert.equal(result.coverage.staleDays, 13);
    assert.equal(
      result.coverage.ready,
      false,
      "a record that stops 13 days ago cannot say anything about today"
    );
  });

  it("is ready when the record is current, allowing for sync lag", () => {
    const result = runDetectors(inputWithSeriesEnding("2026-09-02", 74));

    assert.equal(result.coverage.staleDays, 1);
    assert.equal(result.coverage.ready, true);
  });
});

describe("what the model is told about the record", () => {
  it("names the gap instead of reassuring the user", () => {
    const result = runDetectors(inputWithSeriesEnding("2026-08-21", 74));
    const text = formatFindingsContext(result, []);

    assert.match(text, /ENDS ON 2026-08-21/);
    assert.match(text, /13 days ago/);
    assert.match(text, /backfill/);
    assert.doesNotMatch(
      text,
      /nothing stands out/i,
      "a stale record was reported as a clean bill of health"
    );
  });

  it("still reports a clean bill of health when the record is actually current", () => {
    const result = runDetectors(inputWithSeriesEnding("2026-09-03", 74));
    const text = formatFindingsContext(result, []);

    assert.match(text, /nothing stands out/i);
  });
});

describe("what the model is told when Garmin does not answer", () => {
  it("does not hand the model an empty snapshot header", () => {
    const text = formatHealthContext(EMPTY_SUMMARY);

    assert.doesNotMatch(
      text,
      /Current health snapshot:/,
      "a heading with nothing under it reads as 'you have no data'"
    );
    assert.match(text, /connection problem/i);
    assert.match(text, /do not tell the user you have no access/i);
  });

  it("keeps the header once there is anything real to put under it", () => {
    const withData = {
      ...EMPTY_SUMMARY,
      heart_rate: { resting: 52, max: 178 },
    } as unknown as WatchSummary;

    const text = formatHealthContext(withData);

    assert.match(text, /Current health snapshot:/);
    assert.match(text, /Resting HR: 52 bpm/);
    assert.doesNotMatch(text, /connection problem/i);
  });
});
