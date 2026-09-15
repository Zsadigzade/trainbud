import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import {
  detectHrvTrendBreak,
  detectLoadRatio,
  detectRecoveryStrain,
  detectRestingHrElevation,
  detectSleepDebt,
} from "../src/detect/detectors.js";
import { runDetectors } from "../src/detect/index.js";
import {
  DEFAULT_DETECTOR_RULES,
  type DetectorInput,
  type DetectorRules,
} from "../src/detect/findings.js";
import type { MetricKind } from "../src/history/schema.js";
import type { MetricPoint, StoredActivity } from "../src/history/store.js";

// A reply on r/GarminWatches, to "you can change the threshold if you think it
// is wrong": that was true only for someone willing to edit a TypeScript file.
// The rules a finding fires on now live in the profile, and every finding says
// which rule it fired on -- "transparency about metrics is helpful" was the
// point of the thread, and a detector whose bar cannot be seen or moved is the
// same black box as the score it was built to get around.

const NOW = DateTime.fromISO("2026-08-19T20:00:00", { zone: "utc" });

function series(values: number[]): MetricPoint[] {
  const start = NOW.startOf("day").minus({ days: values.length });
  return values.map((value, index) => ({
    date: start.plus({ days: index + 1 }).toISODate() ?? "",
    value,
  }));
}

function input(
  data: Partial<Record<MetricKind, number[]>>,
  rules?: DetectorRules,
  activities: StoredActivity[] = []
): DetectorInput {
  return {
    now: NOW,
    series: (kind: MetricKind, days: number) => series(data[kind] ?? []).slice(-days),
    activities: () => activities,
    context: () => [],
    ...(rules ? { rules } : {}),
  };
}

function repeat<T>(value: T, count: number): T[] {
  return Array.from({ length: count }, () => value);
}

/** Around `base` with a little night-to-night noise, so the MAD is not zero. */
function noisy(base: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => base + (index % 3) - 1);
}

function withRules(patch: (rules: DetectorRules) => void): DetectorRules {
  const rules = structuredClone(DEFAULT_DETECTOR_RULES);
  patch(rules);
  return rules;
}

function sessions(dailyHr: Array<number | null>, minutes = 45): StoredActivity[] {
  const start = NOW.startOf("day").minus({ days: dailyHr.length });
  return dailyHr.flatMap((avgHr, index) => {
    if (avgHr === null) return [];
    const day = start.plus({ days: index + 1 });
    return [
      {
        activityId: index + 1,
        date: day.toISODate() ?? "",
        startTimeLocal: `${day.toISODate()} 07:30:00`,
        name: "Run",
        type: "running",
        distanceMeters: 8000,
        durationSeconds: minutes * 60,
        avgHr,
        maxHr: avgHr + 15,
        elevationGainMeters: 20,
        calories: 400,
        averageSpeedMps: 3,
      },
    ];
  });
}

const HR_PROFILE = { resting_hr: repeat(50, 35), max_hr: repeat(190, 35) };

describe("detector rules come from the caller, not from constants", () => {
  it("ships defaults equal to the constants the detectors used before", () => {
    assert.deepEqual(DEFAULT_DETECTOR_RULES.restingHr, { days: 3, minZ: 2, minBpm: 3 });
    assert.deepEqual(DEFAULT_DETECTOR_RULES.sleepDebt, { hours: 3 });
    assert.deepEqual(DEFAULT_DETECTOR_RULES.hrv, { dropZ: 2 });
    assert.deepEqual(DEFAULT_DETECTOR_RULES.load, { high: 1.5, low: 0.8 });
  });

  it("resting HR: a higher bpm floor silences a run the default would raise", () => {
    const data = { resting_hr: [...noisy(50, 28), 55, 56, 55] };
    assert.equal(detectRestingHrElevation(input(data))?.kind, "rhr_elevated");
    assert.equal(detectRestingHrElevation(input(data, withRules((r) => (r.restingHr.minBpm = 8)))), null);
  });

  it("resting HR: a two-day window raises a run the default calls too short", () => {
    const data = { resting_hr: [...noisy(50, 29), 56, 57] };
    assert.equal(detectRestingHrElevation(input(data)), null);
    const finding = detectRestingHrElevation(input(data, withRules((r) => (r.restingHr.days = 2))));
    assert.equal(finding?.kind, "rhr_elevated");
    assert.match(finding?.headline ?? "", /2 days running/);
  });

  it("sleep debt: a lower bar raises a smaller shortfall", () => {
    const data = { sleep_seconds: [...repeat(7.5 * 3600, 28), ...repeat(6.9 * 3600, 7)] };
    assert.equal(detectSleepDebt(input(data)), null);
    assert.equal(detectSleepDebt(input(data, withRules((r) => (r.sleepDebt.hours = 0.5))))?.kind, "sleep_debt");
  });

  it("HRV: a stricter drop silences what the default raises", () => {
    const data = { hrv_overnight: [...noisy(45, 28), 40, 39, 41] };
    assert.equal(detectHrvTrendBreak(input(data))?.kind, "hrv_trend_break");
    assert.equal(detectHrvTrendBreak(input(data, withRules((r) => (r.hrv.dropZ = 9)))), null);
  });

  it("load: a higher ceiling silences a spike the default raises", () => {
    const acts = sessions([...repeat(130, 21), ...repeat(175, 7)], 90);
    assert.equal(detectLoadRatio(input(HR_PROFILE, undefined, acts))?.kind, "load_ratio_high");
    assert.equal(detectLoadRatio(input(HR_PROFILE, withRules((r) => (r.load.high = 9)), acts)), null);
  });
});

describe("every finding says which rule it fired on", () => {
  it("names the numbers of the rule in force, not the defaults", () => {
    const data = { resting_hr: [...noisy(50, 28), 60, 61, 60] };
    const finding = detectRestingHrElevation(input(data, withRules((r) => (r.restingHr.minBpm = 4))));
    assert.ok(finding, "expected a finding");
    assert.match(finding.why, /4 bpm/);
    assert.match(finding.why, /median/);
    assert.ok(finding.why.length <= 160, `why is ${finding.why.length} characters`);
  });

  it("is present on every detector's finding", () => {
    const fired = [
      detectRestingHrElevation(input({ resting_hr: [...noisy(50, 28), 56, 57, 56] })),
      detectSleepDebt(input({ sleep_seconds: [...repeat(7.5 * 3600, 28), ...repeat(6 * 3600, 7)] })),
      detectHrvTrendBreak(input({ hrv_overnight: [...noisy(45, 28), 30, 29, 31] })),
      detectLoadRatio(input(HR_PROFILE, undefined, sessions([...repeat(130, 21), ...repeat(175, 7)], 90))),
    ];
    for (const finding of fired) {
      assert.ok(finding, "a detector did not fire");
      assert.ok(finding.why.length > 20, `${finding.kind} has no why`);
      assert.ok(finding.why.length <= 160, `${finding.kind} why is ${finding.why.length} characters`);
    }
  });
});

// A reply hoped the app "would forecast sickness". The data cannot tell an
// infection from a warm bedroom or a glass of wine, and findings.ts forbids
// naming a cause. What it CAN say honestly is that several independent recovery
// signals moved the wrong way together, which is a stronger statement than any
// one of them alone -- and still only a statement about measurements.
describe("recovery strain: several signals off together", () => {
  const STRAINED: Partial<Record<MetricKind, number[]>> = {
    resting_hr: [...noisy(50, 28), 56, 57],
    hrv_overnight: [...noisy(45, 28), 36, 35],
    sleep_stress: [...noisy(20, 28), 30, 31],
  };

  it("fires when resting HR, HRV and sleep stress are all off for the window", () => {
    const finding = detectRecoveryStrain(input(STRAINED));
    assert.equal(finding?.kind, "recovery_strain");
    assert.equal(finding?.severity, "warn");
    assert.ok((finding?.short.length ?? 99) <= 14);
    assert.doesNotMatch(`${finding?.headline} ${finding?.detail} ${finding?.why}`, /ill|sick|infect|virus|disease|covid|flu\b/i);
  });

  it("stays silent when only two of the three moved", () => {
    const calmStress = { ...STRAINED, sleep_stress: noisy(20, 30) };
    assert.equal(detectRecoveryStrain(input(calmStress)), null);
  });

  it("stays silent when one day in the window is normal", () => {
    const oneNormal = { ...STRAINED, hrv_overnight: [...noisy(45, 28), 45, 35] };
    assert.equal(detectRecoveryStrain(input(oneNormal)), null);
  });

  it("can be switched off", () => {
    assert.equal(detectRecoveryStrain(input(STRAINED, withRules((r) => (r.strain.enabled = false)))), null);
  });

  it("stands in for the single-signal findings it already covers", () => {
    const data = {
      ...STRAINED,
      resting_hr: [...noisy(50, 28), 58, 59, 58],
      hrv_overnight: [...noisy(45, 28), 34, 33, 34],
      sleep_stress: [...noisy(20, 28), 31, 30, 32],
      sleep_seconds: repeat(7.5 * 3600, 35),
    };
    const kinds = runDetectors(input(data)).findings.map((finding) => finding.kind);
    assert.ok(kinds.includes("recovery_strain"), `got ${kinds.join(", ")}`);
    assert.ok(!kinds.includes("rhr_elevated"), "resting HR repeated alongside the strain finding");
    assert.ok(!kinds.includes("hrv_trend_break"), "HRV repeated alongside the strain finding");
  });
});
