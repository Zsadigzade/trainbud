import { DateTime } from "luxon";

// SECTION: Charts — inline SVG, no library, no CDN
//
// Every chart on the dashboard is built here, as a pure function from data to
// an SVG string. Three reasons it is not a charting library.
//
// This server is reached over a public tunnel from a phone. A CDN script tag
// would tell a third party every time the user opened their own health
// dashboard, and would leave the page blank on a train. Nothing here loads.
//
// A pure function can be tested. Chart bugs are geometry bugs -- a bar taller
// than its own axis, a line interpolated across a week the watch was not worn
// -- and geometry is exactly what a unit test is good at. A canvas rendered in
// a browser is not.
//
// And the rule that matters most for this product: A MISSING DAY IS A GAP, NOT
// A ZERO. An unworn watch is not a resting heart rate of nothing. Every path
// below breaks at an absence rather than drawing through it, because a line
// that slides smoothly across four unrecorded days is a measurement the chart
// invented -- the same mistake, in pixels, that this codebase has now fixed
// four times in prose.

/** Chart ink. Mirrors the CSS custom properties; SVG attributes cannot read them. */
export const CHART_COLORS = {
  surface: "#141C2E",
  grid: "#22304A",
  ink: "#E6EDF5",
  muted: "#8FA3BD",
  /** Single-series hue. Blue, the documented sequential default, stepped for a dark surface. */
  series: "#3987E5",
  /**
   * Green is #4CD964, not the mint #3DDC84 it started as, because of a device
   * this file never renders on. The Forerunner 55 has an EIGHT-COLOUR palette
   * and Connect IQ snaps every colour to the nearest entry -- #3DDC84 lands on
   * CYAN, so "good" would reach that wrist as a colour carrying no meaning in
   * this system. One palette across the browser and the watch is worth more
   * than the exact shade, so the shade moved. Contrast on the card surface is
   * 9.2:1 either way.
   */
  good: "#4CD964",
  caution: "#F5A623",
  hard: "#E5484D",
} as const;

export interface SeriesPoint {
  date: string;
  value: number | null;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * A chart with nothing to draw says so.
 *
 * Not an empty axis, which reads as "zero everywhere" -- the distinction this
 * whole file exists to preserve.
 */
function emptyChart(width: number, height: number, message: string): string {
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(message)}" preserveAspectRatio="none">
  <text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="middle"
        fill="${CHART_COLORS.muted}" font-size="13">${escapeXml(message)}</text>
</svg>`;
}

/**
 * Fill in every day in the range, marking the ones with no measurement null.
 *
 * The store only holds a row for a day that was actually recorded, so an array
 * of points is not a timeline -- it is a list of the days that happened to have
 * data. Plotting it by index puts a three-week gap and a one-day gap the same
 * distance apart.
 */
export function densify(points: SeriesPoint[], days: number, today = DateTime.local()): SeriesPoint[] {
  const byDate = new Map<string, number | null>();
  for (const point of points) {
    byDate.set(point.date, point.value);
  }

  const out: SeriesPoint[] = [];
  const start = today.startOf("day").minus({ days: days - 1 });
  for (let i = 0; i < days; i += 1) {
    const date = start.plus({ days: i }).toISODate();
    if (date) {
      out.push({ date, value: byDate.get(date) ?? null });
    }
  }
  return out;
}

interface Scale {
  min: number;
  max: number;
}

/**
 * A y-range with headroom, never a zero-height one.
 *
 * A flat series (every value identical) would otherwise divide by zero and put
 * every point at the same pixel with no axis to read it against.
 */
function scaleOf(values: number[], includeZero: boolean): Scale {
  if (values.length === 0) {
    return { min: 0, max: 1 };
  }
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (min === max) {
    const pad = Math.abs(max) > 0 ? Math.abs(max) * 0.1 : 1;
    return { min: min - pad, max: max + pad };
  }
  const pad = (max - min) * 0.12;
  return { min: min - (includeZero && min === 0 ? 0 : pad), max: max + pad };
}

export interface LineChartOptions {
  /** Names what is plotted; a single series needs no legend box. */
  label: string;
  unit?: string;
  /** A reference line — this person's own median, drawn recessive. */
  baseline?: { value: number; label: string } | null;
  width?: number;
  height?: number;
  format?: (value: number) => string;
}

/**
 * A single series over time, with an optional personal baseline.
 *
 * Line rather than area: the question is "where is this going", and an area
 * fill implies a quantity accumulating under the curve, which a heart rate is
 * not.
 */
export function lineChart(points: SeriesPoint[], options: LineChartOptions): string {
  const width = options.width ?? 320;
  const height = options.height ?? 110;
  const padLeft = 34;
  const padRight = 10;
  const padTop = 10;
  const padBottom = 18;

  const measured = points.filter((p): p is { date: string; value: number } => p.value !== null);
  if (measured.length === 0) {
    return emptyChart(width, height, "Nothing recorded yet");
  }

  const format = options.format ?? ((value: number) => String(round(value, 1)));
  const values = measured.map((p) => p.value);
  if (options.baseline) {
    values.push(options.baseline.value);
  }
  const scale = scaleOf(values, false);

  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const x = (index: number) =>
    padLeft + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (value: number) =>
    padTop + plotHeight - ((value - scale.min) / (scale.max - scale.min)) * plotHeight;

  // Break the path at every absence. `M` starts a new subpath, so an unworn
  // week leaves a hole instead of a straight line pretending to be data.
  const segments: string[] = [];
  let open = false;
  points.forEach((point, index) => {
    if (point.value === null) {
      open = false;
      return;
    }
    segments.push(`${open ? "L" : "M"}${round(x(index))} ${round(y(point.value))}`);
    open = true;
  });

  const last = [...points].reverse().find((p) => p.value !== null);
  const lastIndex = last ? points.findIndex((p) => p.date === last.date) : -1;

  const baselineMarkup = options.baseline
    ? `<line x1="${padLeft}" x2="${width - padRight}" y1="${round(y(options.baseline.value))}" y2="${round(y(options.baseline.value))}"
        stroke="${CHART_COLORS.muted}" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"><title>${escapeXml(options.baseline.label)}</title></line>`
    : "";

  const dots = points
    .map((point, index) =>
      point.value === null
        ? ""
        : `<circle cx="${round(x(index))}" cy="${round(y(point.value))}" r="4"
             fill="${CHART_COLORS.series}" stroke="${CHART_COLORS.surface}" stroke-width="2"
             class="dot"><title>${escapeXml(point.date)}: ${escapeXml(format(point.value))}${escapeXml(options.unit ?? "")}</title></circle>`
    )
    .join("");

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img"
     aria-label="${escapeXml(options.label)}" preserveAspectRatio="none">
  <line x1="${padLeft}" x2="${width - padRight}" y1="${padTop}" y2="${padTop}" stroke="${CHART_COLORS.grid}" stroke-width="1"/>
  <line x1="${padLeft}" x2="${width - padRight}" y1="${padTop + plotHeight}" y2="${padTop + plotHeight}" stroke="${CHART_COLORS.grid}" stroke-width="1"/>
  <text x="4" y="${padTop + 4}" fill="${CHART_COLORS.muted}" font-size="10">${escapeXml(format(scale.max))}</text>
  <text x="4" y="${padTop + plotHeight}" fill="${CHART_COLORS.muted}" font-size="10">${escapeXml(format(scale.min))}</text>
  ${baselineMarkup}
  <path d="${segments.join(" ")}" fill="none" stroke="${CHART_COLORS.series}" stroke-width="2"
        stroke-linejoin="round" stroke-linecap="round"/>
  ${dots}
  ${
    lastIndex >= 0 && last?.value !== null && last !== undefined
      ? `<text x="${width - padRight}" y="${round(y(last.value)) - 8}" text-anchor="end"
             fill="${CHART_COLORS.ink}" font-size="11">${escapeXml(format(last.value))}${escapeXml(options.unit ?? "")}</text>`
      : ""
  }
</svg>`;
}

export interface ColumnPoint {
  label: string;
  value: number;
}

export interface ColumnChartOptions {
  label: string;
  width?: number;
  height?: number;
  format?: (value: number) => string;
}

/**
 * Magnitude over a short run of periods.
 *
 * Bars are capped at 24px and always leave a 2px gap, so neighbours read apart
 * because of the air between them rather than because of a stroke drawn round
 * each one. Only the largest bar is labelled: a number on every column is
 * noise, and the tooltip and the table carry the rest.
 */
export function columnChart(points: ColumnPoint[], options: ColumnChartOptions): string {
  const width = options.width ?? 320;
  const height = options.height ?? 110;
  const padLeft = 34;
  const padRight = 10;
  const padTop = 14;
  const padBottom = 16;

  if (points.length === 0) {
    return emptyChart(width, height, "Nothing recorded yet");
  }

  const format = options.format ?? ((value: number) => String(round(value, 2)));
  const maxValue = Math.max(...points.map((p) => p.value));

  // Every column zero is a real and common answer -- a month with no AI calls.
  // It must draw as a flat empty axis, not divide by zero. Drawn short, too:
  // at full height the "nothing" state reserved as much room as a month of
  // data and left a hole in the page.
  if (maxValue <= 0) {
    const flat = 54;
    return `<svg class="chart" viewBox="0 0 ${width} ${flat}" role="img" aria-label="${escapeXml(options.label)}" preserveAspectRatio="none">
  <line x1="${padLeft}" x2="${width - padRight}" y1="${flat - 14}" y2="${flat - 14}" stroke="${CHART_COLORS.grid}" stroke-width="1"/>
  <text x="${width / 2}" y="${flat / 2 - 4}" text-anchor="middle" fill="${CHART_COLORS.muted}" font-size="12">Nothing spent</text>
</svg>`;
  }

  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const slot = plotWidth / points.length;
  const barWidth = Math.max(1, Math.min(24, slot - 2));
  const radius = Math.min(4, barWidth / 2);

  const bars = points
    .map((point, index) => {
      const barHeight = (point.value / maxValue) * plotHeight;
      const bx = round(padLeft + index * slot + (slot - barWidth) / 2);
      const by = round(padTop + plotHeight - barHeight);
      const title = `${escapeXml(point.label)}: ${escapeXml(format(point.value))}`;
      if (barHeight <= 0) {
        // A recorded zero still gets a hit target, so hovering an empty day
        // says "nothing on this day" rather than nothing at all.
        return `<rect x="${bx}" y="${round(padTop + plotHeight - 1)}" width="${round(barWidth)}" height="1"
          fill="${CHART_COLORS.grid}" class="bar"><title>${title}</title></rect>`;
      }
      return `<rect x="${bx}" y="${by}" width="${round(barWidth)}" height="${round(barHeight)}"
        rx="${round(radius)}" fill="${CHART_COLORS.series}" class="bar"><title>${title}</title></rect>`;
    })
    .join("");

  const peakIndex = points.findIndex((p) => p.value === maxValue);
  const peakX = round(padLeft + peakIndex * slot + slot / 2);
  const peakY = round(padTop + plotHeight - (maxValue / maxValue) * plotHeight) - 4;

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img"
     aria-label="${escapeXml(options.label)}" preserveAspectRatio="none">
  <line x1="${padLeft}" x2="${width - padRight}" y1="${padTop + plotHeight}" y2="${padTop + plotHeight}" stroke="${CHART_COLORS.grid}" stroke-width="1"/>
  <text x="4" y="${padTop + 4}" fill="${CHART_COLORS.muted}" font-size="10">${escapeXml(format(maxValue))}</text>
  ${bars}
  <text x="${peakX}" y="${peakY}" text-anchor="middle" fill="${CHART_COLORS.ink}" font-size="11">${escapeXml(format(maxValue))}</text>
</svg>`;
}

export interface DumbbellRow {
  label: string;
  unit: string;
  current: number | null;
  previous: number | null;
}

/**
 * This week against last week, one row per metric.
 *
 * A dumbbell rather than a paired bar chart, and emphasis rather than two
 * categorical hues, for one reason: THESE METRICS DO NOT SHARE AN AXIS. TRIMP
 * and hours and session counts cannot be measured against one scale, and a
 * single chart with two y-axes is the most reliable way to mislead someone.
 * Each row is scaled to its own two values, which is a small multiple.
 *
 * Colour claims nothing about direction. Training load falling 38% is a lapse
 * in January and the entire point of a taper, and a red bar would call it a
 * failure either way -- so last week is recessive grey, this week is the accent,
 * and the reader takes the direction from which way the dot moved.
 */
export function dumbbellChart(rows: DumbbellRow[], options: { width?: number } = {}): string {
  const usable = rows.filter((row) => row.current !== null && row.previous !== null);
  if (usable.length === 0) {
    return emptyChart(options.width ?? 320, 80, "Not enough history to compare weeks");
  }

  const width = options.width ?? 320;
  const rowHeight = 34;
  // The legend sits above the rows and needs clearance from the first label.
  // At 18px the first row's text ran through the legend swatches.
  const firstRowY = 34;
  const height = usable.length * rowHeight + firstRowY + 6;
  const labelWidth = 96;
  const padRight = 46;
  const trackWidth = width - labelWidth - padRight;

  const body = usable
    .map((row, index) => {
      const current = row.current as number;
      const previous = row.previous as number;
      const unchanged = current === previous;

      // Each row is scaled from ZERO to its own larger value, not from its
      // smaller value to its larger one.
      //
      // Scaling min..max was the first attempt and it is worthless: the lower
      // value always lands at one end and the higher at the other, so every row
      // draws the identical length and the bar carries no information at all. A
      // 1.7% move in resting heart rate and a 38% drop in training load came out
      // the same size. Anchored at zero, the length is the relative change --
      // which is the only comparison that means anything across metrics that
      // share no unit.
      const max = Math.max(current, previous, 1);
      const px = labelWidth + (previous / max) * trackWidth;
      const cx = labelWidth + (current / max) * trackWidth;
      const y = firstRowY + index * rowHeight;

      return `
  <text x="0" y="${y + 4}" fill="${CHART_COLORS.muted}" font-size="11">${escapeXml(row.label)}</text>
  <line x1="${round(px)}" x2="${round(cx)}" y1="${y}" y2="${y}" stroke="${CHART_COLORS.grid}" stroke-width="2" stroke-linecap="round"/>
  ${
    unchanged
      ? // Both weeks land on the same point. Drawn as a grey halo behind the
        // accent dot: with the normal marks, this week's 2px surface ring
        // covers last week's dot completely and "no change" renders as "last
        // week is missing" -- an absence, which is the one thing this codebase
        // must never draw a measurement as.
        `<circle cx="${round(cx)}" cy="${y}" r="8" fill="${CHART_COLORS.muted}" opacity="0.45"><title>No change: ${escapeXml(String(current))}${escapeXml(row.unit)}</title></circle>
  <circle cx="${round(cx)}" cy="${y}" r="4" fill="${CHART_COLORS.series}"><title>This week: ${escapeXml(String(current))}${escapeXml(row.unit)}</title></circle>`
      : `<circle cx="${round(px)}" cy="${y}" r="4" fill="${CHART_COLORS.muted}" stroke="${CHART_COLORS.surface}" stroke-width="2"><title>Last week: ${escapeXml(String(previous))}${escapeXml(row.unit)}</title></circle>
  <circle cx="${round(cx)}" cy="${y}" r="5" fill="${CHART_COLORS.series}" stroke="${CHART_COLORS.surface}" stroke-width="2"><title>This week: ${escapeXml(String(current))}${escapeXml(row.unit)}</title></circle>`
  }
  <text x="${width}" y="${y + 4}" text-anchor="end" fill="${CHART_COLORS.ink}" font-size="11">${escapeXml(String(current))}${escapeXml(row.unit)}</text>`;
    })
    .join("");

  // Two marks means a legend, always. Identity never rests on colour alone.
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img"
     aria-label="This week against last week" preserveAspectRatio="none">
  <circle cx="4" cy="6" r="4" fill="${CHART_COLORS.muted}"/>
  <text x="13" y="10" fill="${CHART_COLORS.muted}" font-size="10">last week</text>
  <circle cx="76" cy="6" r="5" fill="${CHART_COLORS.series}"/>
  <text x="86" y="10" fill="${CHART_COLORS.muted}" font-size="10">this week</text>
  ${body}
</svg>`;
}
