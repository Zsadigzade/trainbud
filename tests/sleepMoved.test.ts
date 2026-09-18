import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DateTime } from "luxon";
import { whatMovedLastNight } from "../src/detect/sleepMoved.js";
import type { DetectorInput } from "../src/detect/findings.js";
import type { MetricKind } from "../src/history/schema.js";
import { rederiveSleepFromArchive, runIngest } from "../src/history/ingest.js";
import {
  appendRawPayload,
  closeHistoryDb,
  getMetricSeries,
  openHistoryDb,
} from "../src/history/store.js";
import type { MetricPoint } from "../src/history/store.js";
import type { GarminConnectInstance } from "../src/garmin/garminConnect.js";
import { buildWatchSummaryFrom } from "../src/watchApi.js";
import { buildSleepPayload, renderSleepText } from "../src/tools/sleep.js";

// "Knowing why my sleep score dropped, or went up, would make it easier to
// pinpoint causes." Garmin's score is a black box this app cannot open, so it
// does not pretend to explain it. What it can do is lay last night's own parts
// -- deep, REM, awakenings, sleep stress, HRV -- against this person's usual
// night and say which of them moved. That is a measurement, it is inspectable,
// and it is closer to a cause than the score is.

const NOW = DateTime.fromISO("2026-08-19T09:00:00", { zone: "utc" });

function series(values: number[], endOffsetDays = 0): MetricPoint[] {
  const end = NOW.startOf("day").minus({ days: endOffsetDays });
  return values.map((value, index) => ({
    date: end.minus({ days: values.length - 1 - index }).toISODate() ?? "",
    value,
  }));
}

function noisy(base: number, spread: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => base + ((index % 3) - 1) * spread);
}

function input(data: Partial<Record<MetricKind, MetricPoint[]>>): DetectorInput {
  return {
    now: NOW,
    series: (kind, days) => {
      const cutoff = NOW.startOf("day").minus({ days }).toISODate() ?? "";
      return (data[kind] ?? []).filter((point) => point.date > cutoff);
    },
    activities: () => [],
    context: () => [],
  };
}

const USUAL_NIGHTS = 28;

function usualWith(lastNight: Partial<Record<MetricKind, number>>): Partial<Record<MetricKind, MetricPoint[]>> {
  const base: Partial<Record<MetricKind, number[]>> = {
    sleep_seconds: noisy(7 * 3600, 900, USUAL_NIGHTS),
    sleep_score: noisy(78, 3, USUAL_NIGHTS),
    sleep_deep_seconds: noisy(84 * 60, 6 * 60, USUAL_NIGHTS),
    sleep_rem_seconds: noisy(95 * 60, 8 * 60, USUAL_NIGHTS),
    sleep_awake_count: noisy(2, 1, USUAL_NIGHTS),
    sleep_stress: noisy(20, 2, USUAL_NIGHTS),
    hrv_overnight: noisy(50, 3, USUAL_NIGHTS),
  };
  const out: Partial<Record<MetricKind, MetricPoint[]>> = {};
  for (const [kind, values] of Object.entries(base) as Array<[MetricKind, number[]]>) {
    const tonight = lastNight[kind] ?? values[values.length - 1] ?? 0;
    out[kind] = series([...values, tonight]);
  }
  return out;
}

describe("what moved last night", () => {
  it("names the parts of the night that were unusual for this person, biggest first", () => {
    const moved = whatMovedLastNight(input(usualWith({ sleep_deep_seconds: 40 * 60, sleep_stress: 33, sleep_score: 61 })));

    assert.equal(moved.date, "2026-08-19");
    const kinds = moved.movers.map((mover) => mover.kind);
    assert.ok(kinds.includes("sleep_deep_seconds"), `got ${kinds.join(", ")}`);
    assert.ok(kinds.includes("sleep_stress"), `got ${kinds.join(", ")}`);
    assert.ok(moved.movers.length <= 3);

    const deep = moved.movers.find((mover) => mover.kind === "sleep_deep_seconds");
    assert.match(deep?.text ?? "", /Deep 40m/);
    assert.match(deep?.text ?? "", /usual 1h 24m/);
    assert.equal(deep?.better, false);
    assert.ok((deep?.short.length ?? 99) <= 18, `short "${deep?.short}"`);

    for (let i = 1; i < moved.movers.length; i += 1) {
      assert.ok(Math.abs(moved.movers[i - 1]!.z) >= Math.abs(moved.movers[i]!.z), "not sorted by size");
    }
  });

  it("says nothing moved on an ordinary night rather than inventing a mover", () => {
    const moved = whatMovedLastNight(input(usualWith({})));
    assert.equal(moved.date, "2026-08-19");
    assert.deepEqual(moved.movers, []);
  });

  it("marks a better-than-usual part as better", () => {
    const moved = whatMovedLastNight(input(usualWith({ hrv_overnight: 66 })));
    const hrv = moved.movers.find((mover) => mover.kind === "hrv_overnight");
    assert.equal(hrv?.better, true);
  });

  it("has nothing to say without a recent night", () => {
    const stale = usualWith({ sleep_deep_seconds: 30 * 60 });
    const shifted: Partial<Record<MetricKind, MetricPoint[]>> = {};
    for (const [kind, points] of Object.entries(stale) as Array<[MetricKind, MetricPoint[]]>) {
      shifted[kind] = points.map((point) => ({
        ...point,
        date: DateTime.fromISO(point.date).minus({ days: 10 }).toISODate() ?? "",
      }));
    }
    const moved = whatMovedLastNight(input(shifted));
    assert.equal(moved.date, null);
    assert.deepEqual(moved.movers, []);
  });

  it("skips a part it has too little history to judge", () => {
    const data = usualWith({ sleep_deep_seconds: 30 * 60 });
    data.sleep_deep_seconds = series([84 * 60, 80 * 60, 30 * 60]);
    const moved = whatMovedLastNight(input(data));
    assert.ok(!moved.movers.some((mover) => mover.kind === "sleep_deep_seconds"));
  });
});

// The stage breakdown was archived for every night and never stored as a
// measurement, so a year of deep and REM sat in raw JSON where no baseline
// could reach it. Re-deriving from the archive costs no request to Garmin.
describe("sleep stages from the archive", () => {
  let directory: string;
  let dbIndex = 0;

  beforeEach(() => {
    closeHistoryDb();
    directory ??= fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-sleep-stages-"));
    dbIndex += 1;
    openHistoryDb(path.join(directory, `stages-${dbIndex}.db`));
  });

  after(() => {
    closeHistoryDb();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function night(deep: number, awake = 2) {
    return {
      avgOvernightHrv: 44,
      dailySleepDTO: {
        sleepTimeSeconds: 25200,
        deepSleepSeconds: deep,
        lightSleepSeconds: 13000,
        remSleepSeconds: 5400,
        awakeCount: awake,
        avgSleepStress: 21,
        sleepScores: { overall: { value: 78 } },
      },
    };
  }

  it("stores the stages as measurements on a normal ingest", async () => {
    const client = {
      getSleepData: async () => night(4800, 3),
    } as unknown as GarminConnectInstance;

    await runIngest(client, { days: 1, delayMs: 0, sources: ["sleep"], now: NOW });

    assert.equal(getMetricSeries("sleep_deep_seconds", "2026-08-19", "2026-08-19")[0]?.value, 4800);
    assert.equal(getMetricSeries("sleep_rem_seconds", "2026-08-19", "2026-08-19")[0]?.value, 5400);
    assert.equal(getMetricSeries("sleep_light_seconds", "2026-08-19", "2026-08-19")[0]?.value, 13000);
    assert.equal(getMetricSeries("sleep_awake_count", "2026-08-19", "2026-08-19")[0]?.value, 3);
  });

  it("re-derives them from the newest archived revision of each night", () => {
    appendRawPayload("2026-08-17", "sleep", night(3000), 100);
    appendRawPayload("2026-08-18", "sleep", night(3600), 100);
    appendRawPayload("2026-08-18", "sleep", night(4200), 200);
    appendRawPayload("2026-08-16", "sleep", null, 100);

    const written = rederiveSleepFromArchive();

    assert.equal(written, 2);
    assert.deepEqual(getMetricSeries("sleep_deep_seconds", "2026-08-16", "2026-08-18"), [
      { date: "2026-08-17", value: 3000 },
      { date: "2026-08-18", value: 4200 },
    ]);
  });

  it("is safe to run twice", () => {
    appendRawPayload("2026-08-18", "sleep", night(3600), 100);
    rederiveSleepFromArchive();
    rederiveSleepFromArchive();
    assert.equal(getMetricSeries("sleep_deep_seconds", "2026-08-18", "2026-08-18").length, 1);
  });
});

describe("what moved, on the surfaces that show it", () => {
  const moved = {
    date: "2026-08-19",
    movers: [
      { kind: "sleep_deep_seconds" as MetricKind, label: "Deep", value: 2400, usual: 5040, z: -4.9, better: false, text: "Deep 40m, down from your usual 1h 24m", short: "Deep 40m (1h24m)" },
      { kind: "sleep_stress" as MetricKind, label: "Stress", value: 33, usual: 20, z: 4.4, better: false, text: "Stress 33, up from your usual 20", short: "Stress 33 (20)" },
      { kind: "sleep_score" as MetricKind, label: "Score", value: 61, usual: 78, z: -3.8, better: false, text: "Score 61, down from your usual 78", short: "Score 61 (78)" },
    ],
  };

  function sleepPayload(date: string) {
    return buildSleepPayload(
      [
        {
          date,
          totalSleepSeconds: 25200,
          deepSleepSeconds: 2400,
          lightSleepSeconds: 13000,
          remSleepSeconds: 5400,
          awakeCount: 2,
          sleepScore: 61,
          avgSleepStress: 33,
          avgOvernightHrv: 44,
          hrvStatus: null,
        },
      ],
      1
    );
  }

  const EMPTY = {
    recovery: null,
    activity: null,
    stress: null,
    vo2max: null,
    heartRate: null,
    findings: [],
    coverage: { days: 60, ready: true, throughDate: "2026-08-19", staleDays: 0 },
    context: [],
    week: null,
    race: null,
    updatedAt: "2026-08-19T09:00:00.000Z",
    aiConfigured: false,
    restingHrDeltaBpm: null,
  };

  it("puts the two biggest movers on the watch's sleep card", () => {
    const summary = buildWatchSummaryFrom({ ...EMPTY, sleep: sleepPayload("2026-08-19"), sleepMoved: moved });
    assert.deepEqual(summary.sleep?.moved, ["Deep 40m (1h24m)", "Stress 33 (20)"]);
  });

  it("leaves them off a card that shows a different night", () => {
    const summary = buildWatchSummaryFrom({ ...EMPTY, sleep: sleepPayload("2026-08-18"), sleepMoved: moved });
    assert.equal(summary.sleep?.moved, undefined);
  });

  it("gives the model the movers as measurements, not as an explanation of the score", () => {
    const payload = sleepPayload("2026-08-19");
    payload.moved = moved;
    const text = renderSleepText(payload);
    assert.match(text, /What moved on 2026-08-19/);
    assert.match(text, /Deep 40m, down from your usual 1h 24m/);
    assert.match(text, /not an explanation of Garmin's score/);
  });
});
// The watch line was built with `.slice(0, 18)`, and a cut string is not a
// shorter string. "Sleep 7h30m (8h05m)" is nineteen characters, so the most
// ordinary sleep line there is arrived on the wrist as "Sleep 7h30m (8h05m" --
// one character over, closing bracket gone. The existing test asked only that
// the line was at most eighteen characters, which the broken output satisfied.
describe("the short line the watch draws", () => {
  function shortFor(lastNight: Partial<Record<MetricKind, number>>, kind: MetricKind): string {
    const moved = whatMovedLastNight(input(usualWith(lastNight)));
    const mover = moved.movers.find((m) => m.kind === kind);
    assert.ok(mover, `no mover for ${kind}: got ${moved.movers.map((m) => m.kind).join(", ") || "none"}`);
    return mover.short;
  }

  it("never ships an unbalanced bracket", () => {
    // 7h30m against a usual of about 7h: the exact case that overflowed.
    const short = shortFor({ sleep_seconds: 5 * 3600 }, "sleep_seconds");
    assert.equal(
      (short.match(/\(/g) ?? []).length,
      (short.match(/\)/g) ?? []).length,
      `unbalanced: "${short}"`
    );
    assert.ok(short.length <= 18, `too long: "${short}"`);
  });

  it("drops the usual rather than cutting into it", () => {
    // A double-digit hour count on both sides is the widest this can get.
    const short = shortFor({ sleep_seconds: 12 * 3600 + 35 * 60 }, "sleep_seconds");
    assert.ok(short.startsWith("Sleep "), `lost the label: "${short}"`);
    // Either the whole thing fits, or the parenthetical is gone entirely --
    // never half of it.
    assert.ok(
      /^Sleep \S+$/.test(short) || /^Sleep \S+ \(\S+\)$/.test(short),
      `neither whole nor bare: "${short}"`
    );
  });

  it("keeps the usual whenever it fits", () => {
    // Nothing here should have become terser than it was: the lines that were
    // already inside the budget must still carry their comparison.
    const short = shortFor({ sleep_stress: 33 }, "sleep_stress");
    assert.match(short, /^Stress \d+ \(\d+\)$/);
  });

  it("holds for every part, not only the one that overflowed", () => {
    const moved = whatMovedLastNight(
      input(
        usualWith({
          sleep_seconds: 11 * 3600 + 45 * 60,
          sleep_deep_seconds: 10 * 3600 + 24 * 60,
          sleep_rem_seconds: 10 * 3600 + 2 * 60,
        })
      )
    );
    assert.ok(moved.movers.length > 0, "nothing moved");
    for (const mover of moved.movers) {
      assert.ok(mover.short.length <= 18, `too long: "${mover.short}"`);
      assert.equal(
        (mover.short.match(/\(/g) ?? []).length,
        (mover.short.match(/\)/g) ?? []).length,
        `unbalanced: "${mover.short}"`
      );
    }
  });
});
