import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import {
  columnChart,
  densify,
  dumbbellChart,
  lineChart,
  type SeriesPoint,
} from "../src/dashboardCharts.js";

/** Count of subpaths in a `d` attribute — one per unbroken run of measurements. */
function subpaths(svg: string): number {
  const match = svg.match(/ d="([^"]*)"/);
  return match ? (match[1]?.match(/M/g)?.length ?? 0) : 0;
}

describe("a missing day is a gap, not a zero", () => {
  it("breaks the line where the watch was not worn", () => {
    // The whole point. A line drawn straight across four unrecorded days is a
    // measurement the chart invented, and it looks exactly like real data.
    const points: SeriesPoint[] = [
      { date: "2026-09-01", value: 50 },
      { date: "2026-09-02", value: 51 },
      { date: "2026-09-03", value: null },
      { date: "2026-09-04", value: null },
      { date: "2026-09-05", value: 55 },
    ];
    assert.equal(subpaths(lineChart(points, { label: "Resting HR" })), 2);
  });

  it("draws one unbroken path when nothing is missing", () => {
    const points: SeriesPoint[] = [
      { date: "2026-09-01", value: 50 },
      { date: "2026-09-02", value: 51 },
      { date: "2026-09-03", value: 52 },
    ];
    assert.equal(subpaths(lineChart(points, { label: "Resting HR" })), 1);
  });

  it("says there is nothing rather than drawing an empty axis", () => {
    // An empty axis reads as "zero, every day".
    const svg = lineChart([{ date: "2026-09-01", value: null }], { label: "Resting HR" });
    assert.match(svg, /Nothing recorded yet/);
    assert.doesNotMatch(svg, / d="M/);
  });

  it("places a day by its date, not by its position in the array", () => {
    // The store only holds a row for a day that was recorded, so an array of
    // points is a list of days that happened, not a timeline. Plotted by index,
    // a three-week gap and a one-day gap sit the same distance apart.
    const today = DateTime.fromISO("2026-09-10T12:00:00") as DateTime<true>;
    const dense = densify(
      [
        { date: "2026-09-04", value: 1 },
        { date: "2026-09-10", value: 2 },
      ],
      7,
      today
    );
    assert.equal(dense.length, 7);
    assert.equal(dense[0]?.date, "2026-09-04");
    assert.equal(dense[0]?.value, 1);
    assert.equal(dense[1]?.value, null);
    assert.equal(dense[6]?.value, 2);
  });
});

describe("line chart geometry", () => {
  it("survives a series where every value is identical", () => {
    // A flat series would otherwise divide by zero and stack every point on
    // one pixel with no readable axis.
    const svg = lineChart(
      [
        { date: "2026-09-01", value: 50 },
        { date: "2026-09-02", value: 50 },
      ],
      { label: "Resting HR" }
    );
    assert.doesNotMatch(svg, /NaN|Infinity/);
  });

  it("draws the personal baseline when given one", () => {
    const svg = lineChart([{ date: "2026-09-01", value: 50 }], {
      label: "Resting HR",
      baseline: { value: 48, label: "your 30-day median" },
    });
    assert.match(svg, /stroke-dasharray/);
    assert.match(svg, /your 30-day median/);
  });

  it("labels the last value and no others", () => {
    // Direct labels work because they are sparing.
    const svg = lineChart(
      [
        { date: "2026-09-01", value: 50 },
        { date: "2026-09-02", value: 60 },
        { date: "2026-09-03", value: 70 },
      ],
      { label: "Resting HR", unit: " bpm" }
    );
    // Counted as rendered labels, not as occurrences of the string: the value
    // also appears inside the dot's <title>, which is the hover tooltip and is
    // supposed to be there.
    const labels = [...svg.matchAll(/<text[^>]*font-size="11"[^>]*>([^<]*)</g)].map((m) => m[1]);
    assert.deepEqual(labels, ["70 bpm"]);
  });

  it("escapes text rather than letting it close a tag", () => {
    const svg = lineChart([{ date: "2026-09-01", value: 1 }], {
      label: '</svg><script>alert(1)</script>',
    });
    assert.doesNotMatch(svg, /<script>/);
    assert.match(svg, /&lt;script&gt;/);
  });
});

describe("column chart", () => {
  it("never draws a bar wider than the cap", () => {
    const svg = columnChart([{ label: "a", value: 1 }], { label: "Spend", width: 600 });
    const widths = [...svg.matchAll(/<rect[^>]*width="([\d.]+)"/g)].map((m) => Number(m[1]));
    for (const width of widths) {
      assert.ok(width <= 24, `bar width ${width} exceeds the 24px cap`);
    }
  });

  it("leaves a gap between adjacent bars instead of a stroke", () => {
    const svg = columnChart(
      Array.from({ length: 5 }, (_, i) => ({ label: `d${i}`, value: 1 })),
      { label: "Spend", width: 320 }
    );
    const rects = [...svg.matchAll(/<rect[^>]*x="([\d.]+)"[^>]*width="([\d.]+)"/g)].map((m) => ({
      x: Number(m[1]),
      w: Number(m[2]),
    }));
    for (let i = 1; i < rects.length; i += 1) {
      const gap = rects[i]!.x - (rects[i - 1]!.x + rects[i - 1]!.w);
      assert.ok(gap >= 1.9, `gap of ${gap} between bars ${i - 1} and ${i}`);
    }
    assert.doesNotMatch(svg, /<rect[^>]*stroke="/);
  });

  it("draws a month that cost nothing as an empty axis, not a divide by zero", () => {
    const svg = columnChart(
      Array.from({ length: 30 }, (_, i) => ({ label: `d${i}`, value: 0 })),
      { label: "Spend" }
    );
    assert.doesNotMatch(svg, /NaN|Infinity/);
    assert.match(svg, /Nothing spent/);
  });

  it("labels only the peak", () => {
    const svg = columnChart(
      [
        { label: "a", value: 1 },
        { label: "b", value: 9 },
        { label: "c", value: 3 },
      ],
      { label: "Spend", format: (v) => `$${v}` }
    );
    const labels = [...svg.matchAll(/<text[^>]*font-size="11"[^>]*>([^<]*)</g)].map((m) => m[1]);
    assert.deepEqual(labels, ["$9"]);
  });
});

describe("week-over-week dumbbell", () => {
  it("gives a big relative change a longer bar than a small one", () => {
    // The first version of this chart scaled each row from its own smaller
    // value to its own larger one, so EVERY row drew the same length and the
    // bar said nothing: a 4% move in sleep looked exactly like a 38% drop in
    // load. Anchored at zero, length is the relative change -- the only
    // comparison that means anything across metrics sharing no unit.
    const svg = dumbbellChart([
      { label: "Load", unit: "", current: 320, previous: 520 },
      { label: "Sleep", unit: "h", current: 7.2, previous: 6.9 },
    ]);
    const circles = [...svg.matchAll(/<circle[^>]*cx="([\d.]+)"[^>]*><title>/g)].map((m) =>
      Number(m[1])
    );
    assert.equal(circles.length, 4);
    const loadSpan = Math.abs(circles[1]! - circles[0]!);
    const sleepSpan = Math.abs(circles[3]! - circles[2]!);
    assert.ok(
      loadSpan > sleepSpan * 5,
      `load moved 38% and sleep 4%, but the bars were ${loadSpan} and ${sleepSpan}`
    );
  });

  it("carries a legend, because two marks must never rest on colour alone", () => {
    const svg = dumbbellChart([{ label: "Load", unit: "", current: 1, previous: 2 }]);
    assert.match(svg, /last week/);
    assert.match(svg, /this week/);
  });

  it("skips a metric that has no comparison rather than treating null as zero", () => {
    const svg = dumbbellChart([
      { label: "Load", unit: "", current: 320, previous: null },
      { label: "Sleep", unit: "h", current: 7.2, previous: 6.9 },
    ]);
    assert.doesNotMatch(svg, /Load/);
    assert.match(svg, /Sleep/);
  });

  it("keeps both weeks visible when nothing changed", () => {
    // With the ordinary marks, this week's 2px surface ring covers last week's
    // dot exactly, and "no change" renders as "last week is missing" -- an
    // absence drawn as a measurement, which is the one thing this codebase
    // must never do.
    const svg = dumbbellChart([{ label: "Sessions", unit: "", current: 1, previous: 1 }]);
    assert.match(svg, /No change/);
    const dataDots = [...svg.matchAll(/<circle[^>]*><title>/g)];
    assert.equal(dataDots.length, 2);
  });

  it("says so when there is nothing to compare at all", () => {
    const svg = dumbbellChart([{ label: "Load", unit: "", current: null, previous: null }]);
    assert.match(svg, /Not enough history/);
  });
});
