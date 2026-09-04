import { CARD_IDS } from "./profile.js";
import { PROMPT_MAX_LENGTH, PROMPT_SLOTS } from "./promptSuggestions.js";
import { CONTEXT_KINDS } from "./history/schema.js";
import { appConfig } from "./config.js";
import { columnChart, dumbbellChart, lineChart } from "./dashboardCharts.js";
import { getDashboardData } from "./dashboardData.js";
import type { DashboardData, DashboardTile } from "./dashboardData.js";

export { getDashboardStatus } from "./dashboardData.js";
export type {
  DashboardStatus,
  DashboardContextRow,
  DashboardData,
} from "./dashboardData.js";

// SECTION: HTML dashboard
//
// One page, one column, phone first. The pairing flow is the reason: the user
// is standing next to the watch holding a phone when they approve a code, and
// the old 560px desktop column was the only layout anyone had considered.
//
// Everything after first paint comes from /dashboard/status over fetch. A
// full-page reload every ten seconds used to discard whatever was half-typed
// into the API key field.
//
// Colour rule, and it is the whole design: GREEN, AMBER AND RED MEAN A STATE
// AND NOTHING ELSE. They never decorate a heading, a border or a button. The
// brand lives in the type, the spacing and the page dots. This matters more
// here than it would elsewhere because the same three colours are drawn on a
// watch face from the same server, and a user who learns that amber means
// "look at this" must not then meet amber as a button.

const PALETTE = {
  ground: "#0D1220",
  surface: "#141C2E",
  raised: "#1B2540",
  line: "#22304A",
  ink: "#E6EDF5",
  muted: "#8FA3BD",
  series: "#3987E5",
  // See dashboardCharts.ts: this green is chosen to survive an 8-colour watch.
  good: "#4CD964",
  caution: "#F5A623",
  hard: "#E5484D",
} as const;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CARD_LABELS: Record<string, string> = {
  today: "Today",
  ask: "Ask AI",
  insight: "AI insight",
  week: "Week",
  overview: "Overview",
  recovery: "Recovery",
  sleep: "Sleep",
  activity: "Activity",
  stress: "Stress",
};

/**
 * A tile carries the state as a dot AND a word, never as colour alone.
 *
 * The value itself stays in ink. A light status hue is illegible as text on
 * this surface, and colouring the number would mean the identity channel is
 * doing two jobs at once.
 */
function renderTile(tile: DashboardTile): string {
  const stateWord =
    tile.state === "good"
      ? "in range"
      : tile.state === "caution"
        ? "watch"
        : tile.state === "hard"
          ? "off baseline"
          : "";

  return `<div class="tile">
    <div class="tile-label">${escapeHtml(tile.label)}</div>
    <div class="tile-value">${escapeHtml(tile.value)}</div>
    ${tile.note ? `<div class="tile-note">${escapeHtml(tile.note)}</div>` : `<div class="tile-note">&nbsp;</div>`}
    ${
      stateWord
        ? `<div class="tile-state"><span class="dot dot-${tile.state}"></span>${stateWord}</div>`
        : `<div class="tile-state muted-dim">not graded</div>`
    }
  </div>`;
}

function severityWord(severity: string): string {
  return severity === "warn" ? "hard" : severity === "notice" ? "caution" : "good";
}

function renderToday(data: DashboardData): string {
  if (data.coverageNote) {
    // An empty findings list means two opposite things and the page has to say
    // which. Silence here would read as a clean bill of health for days that
    // were never recorded.
    return `<p class="note">${escapeHtml(data.coverageNote)}</p>`;
  }

  if (data.findings.length === 0) {
    return `<p class="hero-line">Nothing stands out today.</p>
      <p class="muted">Measured against your own baselines over ${data.coverageDays} days.</p>`;
  }

  return data.findings
    .map(
      (finding) => `<div class="finding">
        <div class="finding-head"><span class="dot dot-${severityWord(finding.severity)}"></span>${escapeHtml(finding.headline)}</div>
        <p class="muted">${escapeHtml(finding.detail)}</p>
      </div>`
    )
    .join("");
}

function renderCardRows(order: string[], hidden: string[]): string {
  return order
    .map(
      (id, index) => `<li class="card-row" data-card="${escapeHtml(id)}">
      <label class="card-toggle">
        <input type="checkbox" data-card-visible="${escapeHtml(id)}" ${hidden.includes(id) ? "" : "checked"}>
        <span>${escapeHtml(CARD_LABELS[id] ?? id)}</span>
      </label>
      <span class="card-moves">
        <button type="button" class="btn-icon" data-move="up" data-card-move="${escapeHtml(id)}" ${index === 0 ? "disabled" : ""} aria-label="Move up">&uarr;</button>
        <button type="button" class="btn-icon" data-move="down" data-card-move="${escapeHtml(id)}" ${index === order.length - 1 ? "disabled" : ""} aria-label="Move down">&darr;</button>
      </span>
    </li>`
    )
    .join("");
}

/**
 * One row of the Ask-menu editor.
 *
 * Rendered server-side for the questions that exist and once more into a
 * `<template>`, so the Add button clones the same markup rather than a second
 * copy of it written in the client script. Two copies of a row is how an
 * attribute gets fixed in one place and not the other.
 *
 * The move buttons carry no `disabled` here: the client recomputes them on
 * load, on add and on remove, and one owner of that rule is enough.
 */
function promptRow(text: string): string {
  return `<li class="card-row prompt-row">
      <input type="text" class="prompt-text" maxlength="${PROMPT_MAX_LENGTH}"
             value="${escapeHtml(text)}" placeholder="A question in your own words"
             aria-label="Ask question">
      <span class="card-moves">
        <span class="prompt-count muted">0/${PROMPT_MAX_LENGTH}</span>
        <button type="button" class="btn-icon" data-move="up" data-prompt-move="up" aria-label="Move up">&uarr;</button>
        <button type="button" class="btn-icon" data-move="down" data-prompt-move="down" aria-label="Move down">&darr;</button>
        <button type="button" class="btn-icon" data-prompt-remove aria-label="Remove">&times;</button>
      </span>
    </li>`;
}

function renderPromptRows(prompts: string[]): string {
  return prompts.map((text) => promptRow(text)).join("");
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function renderDashboard(publicUrl?: string): string {
  const data = getDashboardData(publicUrl);
  const serverUrl = data.public_url || `http://localhost:${appConfig.mcpPort}`;
  const tunnelConfigured = data.public_url.length > 0;
  const profile = data.profile;

  const weekChart = dumbbellChart(data.week.rows, { width: 320 });
  const rhrChart = lineChart(data.trends.restingHr.points, {
    label: "Resting heart rate, 30 days",
    unit: " bpm",
    baseline:
      data.trends.restingHr.baseline === null
        ? null
        : { value: data.trends.restingHr.baseline, label: "your 30-day median" },
    format: (value) => String(Math.round(value)),
  });
  const sleepChart = lineChart(data.trends.sleep.points, {
    label: "Sleep, 30 days",
    unit: " h",
    baseline:
      data.trends.sleep.baseline === null
        ? null
        : { value: data.trends.sleep.baseline, label: "your usual night" },
    format: (value) => value.toFixed(1),
  });
  const spendChart = columnChart(
    data.usage.daily.map((day) => ({ label: day.day, value: day.costUsd })),
    { label: "AI spend, 30 days", format: money }
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="referrer" content="no-referrer">
  <title>TrainBud</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --ground: ${PALETTE.ground};
      --surface: ${PALETTE.surface};
      --raised: ${PALETTE.raised};
      --line: ${PALETTE.line};
      --ink: ${PALETTE.ink};
      --muted: ${PALETTE.muted};
      --series: ${PALETTE.series};
      --good: ${PALETTE.good};
      --caution: ${PALETTE.caution};
      --hard: ${PALETTE.hard};
    }
    html { -webkit-text-size-adjust: 100%; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      background: var(--ground); color: var(--ink);
      line-height: 1.5; font-size: 15px;
      padding: 16px 16px 56px;
    }
    .wrap { max-width: 640px; margin: 0 auto; }

    header { padding: 4px 0 20px; }
    h1 { font-size: 1.15rem; font-weight: 650; letter-spacing: -0.01em; }
    .sub { color: var(--muted); font-size: 0.8rem; margin-top: 2px; overflow-wrap: anywhere; }

    section { background: var(--surface); border: 1px solid var(--line); border-radius: 12px;
              padding: 16px; margin-bottom: 14px; }
    h2 { font-size: 0.72rem; font-weight: 600; color: var(--muted);
         text-transform: uppercase; letter-spacing: 0.09em; margin-bottom: 12px; }
    h3 { font-size: 0.85rem; font-weight: 600; margin: 16px 0 6px; }
    .muted { color: var(--muted); font-size: 0.85rem; }
    .muted-dim { color: var(--muted); opacity: 0.6; font-size: 0.75rem; }

    /* The one hero line on the page. */
    .hero-line { font-size: 1.05rem; font-weight: 550; }
    .note { color: var(--ink); font-size: 0.9rem; background: var(--raised);
            border-left: 2px solid var(--caution); border-radius: 0 8px 8px 0; padding: 10px 12px; }

    .finding { padding: 10px 0; border-bottom: 1px solid var(--line); }
    .finding:last-child { border-bottom: none; padding-bottom: 0; }
    .finding-head { font-weight: 550; font-size: 0.95rem; display: flex; gap: 8px; align-items: baseline; }

    /* Status is a dot plus a word. Never colour alone, never on text. */
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; }
    .dot-good { background: var(--good); }
    .dot-caution { background: var(--caution); }
    .dot-hard { background: var(--hard); }
    .dot-unknown { background: var(--muted); }

    .tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    @media (min-width: 520px) { .tiles { grid-template-columns: repeat(4, 1fr); } }
    .tile { background: var(--raised); border-radius: 10px; padding: 12px; }
    .tile-label { color: var(--muted); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; }
    .tile-value { font-size: 1.5rem; font-weight: 600; margin-top: 4px; letter-spacing: -0.02em; }
    .tile-note { color: var(--muted); font-size: 0.75rem; }
    .tile-state { font-size: 0.72rem; color: var(--muted); margin-top: 6px;
                  display: flex; align-items: center; gap: 6px; }

    /* Capped on purpose. An SVG with width:100% scales its own text with it,
       so on a wide screen a 320-unit viewBox doubled and the chart labels came
       out twice the size of the body copy. The cap keeps every chart between
       roughly 0.85x and 1.2x of its natural size, which is the range where the
       11px labels stay 11px-ish at both ends. */
    .chart { width: 100%; max-width: 420px; height: auto; display: block; margin-top: 6px; }
    .chart .bar, .chart .dot { transition: opacity .12s; }
    .chart:hover .bar, .chart:hover .dot { opacity: .55; }
    .chart .bar:hover, .chart .dot:hover { opacity: 1; }

    .row { display: flex; align-items: center; justify-content: space-between;
           gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line); }
    .row:last-child { border-bottom: none; }
    .row .label { color: var(--muted); font-size: 0.85rem; }
    .ok { color: var(--good); font-size: 0.85rem; }
    .warn { color: var(--caution); font-size: 0.85rem; }
    .err { color: var(--hard); font-size: 0.85rem; }

    button { font: inherit; border: none; border-radius: 8px; padding: 9px 16px;
             cursor: pointer; color: var(--ink); background: var(--raised); }
    button:hover { background: #24304f; }
    button:disabled { opacity: .35; cursor: default; }
    button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--series); outline-offset: 1px; }
    .btn-primary { background: var(--series); color: #fff; font-weight: 550; }
    .btn-primary:hover { background: #2f6fc4; }
    .btn-icon { padding: 4px 9px; font-size: 0.85rem; }

    label.field { display: block; margin-bottom: 10px; }
    label.field > span { display: block; color: var(--muted); font-size: 0.78rem; margin-bottom: 4px; }
    input, select { font: inherit; width: 100%; background: var(--ground); color: var(--ink);
                    border: 1px solid var(--line); border-radius: 8px; padding: 9px 11px; }
    input[type=checkbox] { width: auto; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }

    details { border-top: 1px solid var(--line); }
    details > summary { cursor: pointer; padding: 13px 0; font-size: 0.9rem; font-weight: 550;
                        list-style: none; display: flex; justify-content: space-between; align-items: center; }
    details > summary::-webkit-details-marker { display: none; }
    details > summary::after { content: "+"; color: var(--muted); font-size: 1.1rem; }
    details[open] > summary::after { content: "\\2212"; }
    details > div.body { padding-bottom: 16px; }

    .pair-card { display: flex; align-items: center; gap: 14px; padding: 12px;
                 background: var(--raised); border-radius: 10px; margin-bottom: 8px; flex-wrap: wrap; }
    .code { font-size: 1.8rem; font-weight: 700; letter-spacing: 0.22em; font-variant-numeric: tabular-nums; }

    ul.cards { list-style: none; }
    .card-row { display: flex; align-items: center; justify-content: space-between;
                padding: 7px 0; border-bottom: 1px solid var(--line); }
    .card-row:last-child { border-bottom: none; }
    .card-toggle { display: flex; align-items: center; gap: 10px; font-size: 0.9rem; }
    .card-moves { display: flex; gap: 6px; align-items: center; }
    .prompt-row { gap: 10px; }
    .prompt-row input { flex: 1 1 auto; min-width: 0; }
    /* Tabular figures so the count does not jitter the buttons sideways as it
       ticks from 9 to 10. */
    .prompt-count { font-size: 0.75rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .prompt-count.full { color: var(--caution); }

    pre { background: var(--ground); border: 1px solid var(--line); border-radius: 8px;
          padding: 11px; overflow-x: auto; font-size: 0.78rem; color: var(--muted); }
    code { color: #7CC4FF; font-family: ui-monospace, "SF Mono", Menlo, monospace; overflow-wrap: anywhere; }
    table { width: 100%; border-collapse: collapse; font-size: 0.82rem; font-variant-numeric: tabular-nums; }
    th { text-align: left; color: var(--muted); font-weight: 500; font-size: 0.72rem;
         text-transform: uppercase; letter-spacing: 0.06em; padding: 6px 0; }
    td { padding: 6px 0; border-top: 1px solid var(--line); }
    td.num { text-align: right; }

    .toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: 20px;
             background: var(--raised); border: 1px solid var(--line); color: var(--ink);
             padding: 11px 20px; border-radius: 10px; font-size: 0.88rem;
             opacity: 0; transition: opacity .2s; pointer-events: none; max-width: 90vw; }
    .toast.show { opacity: 1; }
    .toast.err { border-color: var(--hard); }
    @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>${profile.displayName ? escapeHtml(profile.displayName) : "TrainBud"}</h1>
      <p class="sub"><code>${escapeHtml(serverUrl)}</code></p>
    </header>

    <section>
      <h2>Today</h2>
      ${renderToday(data)}
      ${
        data.race
          ? `<p class="muted" style="margin-top:10px">${escapeHtml(data.race.text)} — ${data.race.daysAway} day${data.race.daysAway === 1 ? "" : "s"} away (${escapeHtml(data.race.phase.replace(/_/g, " "))}).</p>`
          : ""
      }
      <div class="tiles" style="margin-top:14px">
        ${data.tiles.map(renderTile).join("")}
      </div>
      ${data.insight ? `<p class="muted" style="margin-top:14px"><strong style="color:var(--ink);font-weight:550">Today's insight.</strong> ${escapeHtml(data.insight)}</p>` : ""}
    </section>

    <section>
      <h2>This week</h2>
      <p class="muted">${escapeHtml(data.week.headline)}</p>
      ${weekChart}
      ${
        data.week.forecastRatio !== null
          ? `<p class="muted" style="margin-top:10px">If this week repeats, the acute:chronic load ratio lands at ${data.week.forecastRatio} — ${escapeHtml(data.week.forecastVerdict.replace(/_/g, " "))}.</p>`
          : ""
      }
    </section>

    <section>
      <h2>Against your own baseline</h2>
      <h3>Resting heart rate</h3>
      ${rhrChart}
      <h3>Sleep</h3>
      ${sleepChart}
      <p class="muted" style="margin-top:8px">The dashed line is your own 30-day median. A break in the line is a day with no measurement, not a zero.</p>
    </section>

    <section>
      <h2>Watch pairing</h2>
      <div id="pairing"></div>
      <p class="muted" style="margin-top:8px">Open TrainBud on your watch — it shows a 6-digit code — then approve it here.</p>
    </section>

    <section>
      <h2>Connection</h2>
      <p class="muted">What the watch would see if it called right now. Everything else on this page reports on this machine, which is exactly why a dead tunnel once looked like a broken AI.</p>
      <div id="selftest" style="margin-top:10px"></div>
      <div class="actions"><button type="button" id="run-selftest">Run check</button></div>
      ${tunnelConfigured ? "" : `<p class="note" style="margin-top:12px">No public URL. Set <code>TRAINBUD_PUBLIC_URL</code> in .env, or run <code>scripts/start-watch-stack.ps1</code>, so the watch has somewhere to reach.</p>`}
    </section>

    <section>
      <h2>Settings</h2>

      <details>
        <summary>You</summary>
        <div class="body">
          <p class="muted" style="margin-bottom:12px">Garmin measures you. It has no idea what you are training for — and that is what makes a finding worth anything.</p>
          <form id="profile-form">
            <label class="field"><span>Name</span>
              <input type="text" name="displayName" maxlength="60" value="${escapeHtml(profile.displayName ?? "")}" placeholder="Optional"></label>
            <div class="grid2">
              <label class="field"><span>Units</span>
                <select name="units">
                  <option value="metric"${profile.units === "metric" ? " selected" : ""}>Metric (km, kg)</option>
                  <option value="imperial"${profile.units === "imperial" ? " selected" : ""}>Imperial (mi, lb)</option>
                </select></label>
              <label class="field"><span>Primary sport</span>
                <select name="primarySport">
                  <option value="">Not set</option>
                  ${["running", "cycling", "swimming", "strength", "mixed"]
                    .map(
                      (sport) =>
                        `<option value="${sport}"${profile.primarySport === sport ? " selected" : ""}>${sport[0]?.toUpperCase()}${sport.slice(1)}</option>`
                    )
                    .join("")}
                </select></label>
            </div>
            <div class="grid2">
              <label class="field"><span>Sessions a week</span>
                <input type="number" name="weeklySessions" min="0" max="30" value="${profile.weeklyGoal.sessions ?? ""}" placeholder="—"></label>
              <label class="field"><span>Minutes a week</span>
                <input type="number" name="weeklyMinutes" min="0" max="10000" value="${profile.weeklyGoal.minutes ?? ""}" placeholder="—"></label>
            </div>
            <div class="actions"><button type="submit" class="btn-primary">Save</button></div>
          </form>
        </div>
      </details>

      <details>
        <summary>Goals, races and injuries</summary>
        <div class="body">
          <div id="context"></div>
          <form id="context-form" style="margin-top:12px">
            <div class="grid2">
              <label class="field"><span>Kind</span>
                <select name="kind">${CONTEXT_KINDS.map((kind) => `<option value="${kind}">${kind}</option>`).join("")}</select></label>
              <label class="field"><span>Date (a race is dated on the day)</span>
                <input type="date" name="effective_to"></label>
            </div>
            <label class="field"><span>What is it</span>
              <input type="text" name="text" placeholder="Half marathon, Oct 12" maxlength="200" required></label>
            <div class="actions"><button type="submit" class="btn-primary">Add</button></div>
          </form>
        </div>
      </details>

      <details>
        <summary>Your own thresholds</summary>
        <div class="body">
          <p class="muted" style="margin-bottom:12px">Where green becomes amber, and amber becomes red — on the watch as well as here. Resting heart rate is graded on the distance from your own median, never on the rate itself.</p>
          <form id="thresholds-form">
            ${[
              { key: "recovery", label: "Recovery score", hint: "higher is better" },
              { key: "sleepHours", label: "Sleep hours", hint: "higher is better" },
              { key: "stress", label: "Stress average", hint: "lower is better" },
              { key: "restingHrDelta", label: "Resting HR above median (bpm)", hint: "lower is better" },
            ]
              .map(
                (band) => `<h3>${band.label} <span class="muted-dim">${band.hint}</span></h3>
              <div class="grid2">
                <label class="field"><span>Good at</span>
                  <input type="number" step="0.1" name="${band.key}.good" value="${profile.thresholds[band.key as keyof typeof profile.thresholds].good}"></label>
                <label class="field"><span>Caution at</span>
                  <input type="number" step="0.1" name="${band.key}.caution" value="${profile.thresholds[band.key as keyof typeof profile.thresholds].caution}"></label>
              </div>`
              )
              .join("")}
            <div class="actions">
              <button type="submit" class="btn-primary">Save</button>
              <button type="button" id="thresholds-reset">Reset to defaults</button>
            </div>
          </form>
        </div>
      </details>

      <details>
        <summary>Watch cards</summary>
        <div class="body">
          <p class="muted" style="margin-bottom:12px">The carousel on your wrist, in this order. Live on the watch's next fetch — no Connect IQ settings, no store update.</p>
          <ul class="cards" id="card-list">${renderCardRows(profile.cards.order, profile.cards.hidden)}</ul>
          <div class="actions"><button type="button" id="cards-save" class="btn-primary">Save order</button></div>
        </div>
      </details>

      <details>
        <summary>AI</summary>
        <div class="body">
          <div class="row"><span class="label">Provider key</span>
            <span id="ai-status" class="${data.ai_configured ? "ok" : "warn"}">${data.ai_configured ? "configured" : "not set"}</span></div>
          <form id="key-form" autocomplete="off" style="margin-top:12px">
            <label class="field"><span>Anthropic API key</span>
              <input type="password" name="anthropic_api_key" placeholder="sk-ant-..." autocomplete="off"></label>
            <p class="muted">Stored in <code>.trainbud/app.db</code> on this machine, sent only to the provider. Leave blank to keep the current key.</p>
            <div class="actions">
              <button type="submit" class="btn-primary">Save key</button>
              <button type="button" id="regen">Regenerate today's insight</button>
            </div>
          </form>

          <form id="ai-form" style="margin-top:18px">
            <div class="grid2">
              <label class="field"><span>Model</span>
                <select name="model">
                  ${[
                    ["claude-haiku-4-5", "Haiku 4.5 — cheapest"],
                    ["claude-sonnet-5", "Sonnet 5"],
                    ["claude-opus-5", "Opus 5 — most capable"],
                  ]
                    .map(
                      ([id, label]) =>
                        `<option value="${id}"${profile.ai.model === id ? " selected" : ""}>${label}</option>`
                    )
                    .join("")}
                </select></label>
              <label class="field"><span>Answer length</span>
                <select name="length">
                  ${[["short", "Short"], ["normal", "Normal"], ["detailed", "Detailed"]]
                    .map(
                      ([id, label]) =>
                        `<option value="${id}"${profile.ai.length === id ? " selected" : ""}>${label}</option>`
                    )
                    .join("")}
                </select></label>
            </div>
            <label class="field"><span>Tone</span>
              <select name="tone">
                ${[
                  ["direct", "Direct — no padding"],
                  ["supportive", "Supportive"],
                  ["technical", "Technical — name the metric"],
                ]
                  .map(
                    ([id, label]) =>
                      `<option value="${id}"${profile.ai.tone === id ? " selected" : ""}>${label}</option>`
                  )
                  .join("")}
              </select></label>
            <div class="field">
              <span>Your own Ask questions</span>
              <ul class="cards" id="prompt-list">${renderPromptRows(profile.ai.customPrompts)}</ul>
              <template id="prompt-template">${promptRow("")}</template>
              <p class="muted" id="prompt-empty"${profile.ai.customPrompts.length ? ' hidden' : ""}>
                None yet — the watch offers questions drawn from what fired.
              </p>
              <div class="actions"><button type="button" id="prompt-add">Add question</button></div>
            </div>
            <p class="muted">These lead the Ask menu on your wrist, in this order, in every state.
              Whatever is left of the ${PROMPT_SLOTS} slots is filled from what actually fired — "Why is my
              resting HR up?" on the day it is. ${PROMPT_MAX_LENGTH} characters is what the watch can draw
              on one line; longer wraps into the next question.</p>

            <label class="field"><span>Monthly spending cap (USD)</span>
              <input type="number" name="monthlyUsd" min="0" step="0.5" value="${profile.budget.monthlyUsd ?? ""}" placeholder="No cap"></label>
            <p class="muted">Empty means no cap and nothing is ever refused. With a number, an Ask past the cap is refused on the watch with a message rather than silently charged.</p>
            <div class="actions"><button type="submit" class="btn-primary">Save</button></div>
          </form>
        </div>
      </details>

      <details>
        <summary>Privacy</summary>
        <div class="body">
          <form id="analytics-form">
            <label class="card-toggle">
              <input type="checkbox" name="analytics"${profile.analytics.enabled ? " checked" : ""}>
              <span>Count which features I use</span>
            </label>
            <p class="muted" style="margin-top:8px">Counters kept in <code>.trainbud/app.db</code> on this machine. There is no endpoint to send them to, and none is planned. Turning this off stops the counting; it does not delete what is already there.</p>
            <div class="actions">
              <button type="submit" class="btn-primary">Save</button>
              <button type="button" id="analytics-clear">Delete what is stored</button>
            </div>
          </form>
        </div>
      </details>
    </section>

    <section>
      <h2>Usage</h2>
      <div class="row"><span class="label">This month</span>
        <span>${money(data.usage.month.costUsd)}${data.usage.month.unpricedCalls > 0 ? " +" : ""} · ${data.usage.month.calls} call${data.usage.month.calls === 1 ? "" : "s"}</span></div>
      <div class="row"><span class="label">Monthly cap</span>
        <span class="${data.usage.budget.exceeded ? "err" : "muted"}">${data.usage.budget.capUsd === null ? "none set" : money(data.usage.budget.capUsd)}</span></div>
      ${
        data.usage.month.unpricedCalls > 0
          ? `<p class="note" style="margin-top:10px">${data.usage.month.unpricedCalls} call${data.usage.month.unpricedCalls === 1 ? "" : "s"} used a model this build has no published price for, so the total above is a floor, not a total.</p>`
          : ""
      }
      ${spendChart}
      ${
        data.usage.features.length > 0
          ? `<h3>What gets used</h3>
      <table><thead><tr><th>Feature</th><th class="num">30 days</th></tr></thead><tbody>
        ${data.usage.features
          .slice(0, 12)
          .map(
            (feature) =>
              `<tr><td>${escapeHtml(feature.name)}</td><td class="num">${feature.count}</td></tr>`
          )
          .join("")}
      </tbody></table>`
          : `<p class="muted" style="margin-top:10px">Nothing counted yet.</p>`
      }
    </section>

    <section>
      <h2>Watch setup</h2>
      <p class="muted">In the Connect IQ app, open TrainBud &rarr; settings and set Server URL to:</p>
      <pre id="setup-url">${escapeHtml(serverUrl)}</pre>
      <div class="actions"><button type="button" id="copy-url">Copy URL</button></div>
    </section>
  </div>

  <div id="toast" class="toast" role="status" aria-live="polite"></div>

  <script>
    // The page is reached with ?token=..., and every endpoint accepts that same
    // value as a Bearer header. Held in memory so no link or form has to carry
    // it: the old redirect-after-save dropped it and landed on a 401.
    var TOKEN = new URLSearchParams(location.search).get('token') || '';

    function authHeaders(extra) {
      var h = extra || {};
      if (TOKEN) { h['Authorization'] = 'Bearer ' + TOKEN; }
      return h;
    }

    function toast(message, isError) {
      var el = document.getElementById('toast');
      el.textContent = message;
      el.className = 'toast show' + (isError ? ' err' : '');
      setTimeout(function () { el.className = 'toast'; }, 2800);
    }

    function saveProfile(patch, okMessage) {
      return fetch('/api/profile', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json', 'Accept': 'application/json' }),
        body: JSON.stringify(patch)
      }).then(function (r) {
        return r.json().then(function (body) {
          // The server names the field it refused, so the message can say which
          // input was wrong instead of colouring the whole form red.
          if (!r.ok) { throw new Error(body.message || 'Could not save that'); }
          toast(okMessage || 'Saved');
          return body.profile;
        });
      }).catch(function (e) { toast(e.message, true); });
    }

    // Every value below comes from the server's own JSON, but that JSON quotes
    // bytes fetched from whatever answers the public URL -- a host we do not
    // control. textContent everywhere; innerHTML would run it.
    function renderSelfTest(result) {
      var host = document.getElementById('selftest');
      host.innerHTML = '';
      result.checks.forEach(function (check) {
        var row = document.createElement('div');
        row.className = 'row';
        var label = document.createElement('span');
        label.className = 'label';
        label.textContent = check.name;
        var state = document.createElement('span');
        state.className = check.ok ? 'ok' : (check.warning ? 'warn' : 'err');
        state.textContent = check.ok ? 'ok' : (check.warning ? 'warning' : 'failed');
        row.appendChild(label); row.appendChild(state); host.appendChild(row);

        var detail = document.createElement('p');
        detail.className = 'muted';
        detail.style.margin = '2px 0 10px';
        detail.textContent = check.detail + (check.fix ? '  \\u2192  ' + check.fix : '');
        host.appendChild(detail);
      });
    }

    function loadSelfTest() {
      var host = document.getElementById('selftest');
      host.textContent = 'Checking...';
      fetch('/dashboard/selftest', { headers: authHeaders({ 'Accept': 'application/json' }) })
        .then(function (r) { return r.json(); })
        .then(renderSelfTest)
        .catch(function () { toast('Could not run the check', true); });
    }

    function renderPairing(pending) {
      var host = document.getElementById('pairing');
      host.innerHTML = '';
      if (!pending.length) {
        var none = document.createElement('p');
        none.className = 'muted';
        none.textContent = 'No pending pairing requests.';
        host.appendChild(none);
        return;
      }
      pending.forEach(function (p) {
        var mins = Math.floor(p.expires_in / 60);
        var secs = p.expires_in % 60;
        var left = p.expires_in <= 0 ? 'expired' : (mins > 0 ? mins + 'm ' + secs + 's' : secs + 's');

        var card = document.createElement('div');
        card.className = 'pair-card';
        var code = document.createElement('div');
        code.className = 'code';
        code.textContent = p.code;
        var when = document.createElement('div');
        when.className = 'muted';
        when.textContent = 'Expires in ' + left;
        var btn = document.createElement('button');
        btn.className = 'btn-primary';
        btn.textContent = 'Approve';
        btn.addEventListener('click', function () { approve(p.code); });
        card.appendChild(code); card.appendChild(when); card.appendChild(btn);
        host.appendChild(card);
      });
    }

    function approve(code) {
      fetch('/dashboard/pair/approve', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }),
        body: 'code=' + encodeURIComponent(code)
      }).then(function (r) {
        if (!r.ok) { throw new Error('Approve failed (' + r.status + ')'); }
        toast('Watch paired');
        refresh();
      }).catch(function (e) { toast(e.message, true); });
    }

    function renderContext(entries) {
      var host = document.getElementById('context');
      host.innerHTML = '';
      if (!entries || entries.length === 0) {
        var none = document.createElement('p');
        none.className = 'muted';
        none.textContent = 'Nothing on record yet.';
        host.appendChild(none);
        return;
      }
      entries.forEach(function (entry) {
        var row = document.createElement('div');
        row.className = 'row';
        var label = document.createElement('span');
        label.textContent = entry.kind + ': ' + entry.text +
          (entry.effective_to ? ' (until ' + entry.effective_to + ')' : '');
        var close = document.createElement('button');
        close.textContent = 'Done';
        close.addEventListener('click', function () { closeContext(entry.id); });
        row.appendChild(label); row.appendChild(close);
        host.appendChild(row);
      });
    }

    function closeContext(id) {
      fetch('/dashboard/context/close', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json', 'Accept': 'application/json' }),
        body: JSON.stringify({ id: id })
      }).then(function (r) {
        if (!r.ok) { throw new Error('Could not close that entry'); }
        toast('Closed');
        refresh();
      }).catch(function (e) { toast(e.message, true); });
    }

    function refresh() {
      fetch('/dashboard/status', { headers: authHeaders({ 'Accept': 'application/json' }) })
        .then(function (r) {
          if (!r.ok) { throw new Error('status ' + r.status); }
          return r.json();
        })
        .then(function (s) {
          renderPairing(s.pending);
          renderContext(s.context);
          var ai = document.getElementById('ai-status');
          ai.textContent = s.ai_configured ? 'configured' : 'not set';
          ai.className = s.ai_configured ? 'ok' : 'warn';
        })
        .catch(function () { /* transient - the next tick retries */ });
    }

    document.getElementById('profile-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      function numberOrNull(input) {
        var raw = input.value.trim();
        return raw === '' ? null : Number(raw);
      }
      saveProfile({
        displayName: f.displayName.value.trim() || null,
        units: f.units.value,
        primarySport: f.primarySport.value || null,
        weeklyGoal: {
          sessions: numberOrNull(f.weeklySessions),
          minutes: numberOrNull(f.weeklyMinutes)
        }
      }, 'Profile saved');
    });

    document.getElementById('thresholds-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var thresholds = {};
      Array.prototype.forEach.call(e.target.querySelectorAll('input[name*="."]'), function (input) {
        var parts = input.name.split('.');
        thresholds[parts[0]] = thresholds[parts[0]] || {};
        thresholds[parts[0]][parts[1]] = Number(input.value);
      });
      saveProfile({ thresholds: thresholds }, 'Thresholds saved');
    });

    document.getElementById('thresholds-reset').addEventListener('click', function () {
      fetch('/api/profile', { headers: authHeaders({ 'Accept': 'application/json' }) })
        .then(function (r) { return r.json(); })
        .then(function (body) {
          return saveProfile({ thresholds: body.defaults.thresholds }, 'Thresholds reset');
        })
        .then(function () { location.reload(); })
        .catch(function (e) { toast(e.message, true); });
    });

    (function cardOrdering() {
      var list = document.getElementById('card-list');

      function refreshMoveButtons() {
        var rows = list.querySelectorAll('.card-row');
        rows.forEach(function (row, index) {
          row.querySelector('[data-move="up"]').disabled = index === 0;
          row.querySelector('[data-move="down"]').disabled = index === rows.length - 1;
        });
      }

      list.addEventListener('click', function (e) {
        var button = e.target.closest('[data-card-move]');
        if (!button) { return; }
        var row = button.closest('.card-row');
        if (button.getAttribute('data-move') === 'up' && row.previousElementSibling) {
          list.insertBefore(row, row.previousElementSibling);
        } else if (button.getAttribute('data-move') === 'down' && row.nextElementSibling) {
          list.insertBefore(row.nextElementSibling, row);
        }
        refreshMoveButtons();
      });

      document.getElementById('cards-save').addEventListener('click', function () {
        var order = [];
        var hidden = [];
        list.querySelectorAll('.card-row').forEach(function (row) {
          var id = row.getAttribute('data-card');
          order.push(id);
          if (!row.querySelector('input[type=checkbox]').checked) { hidden.push(id); }
        });
        saveProfile({ cards: { order: order, hidden: hidden } }, 'Card order saved');
      });
    })();

    // The Ask menu the user writes for themselves. Rows are ordered, so the
    // editor needs the same up/down the card list has -- the order is what the
    // watch draws, and there are only ${PROMPT_SLOTS} slots to spend.
    var askQuestions = (function () {
      var list = document.getElementById('prompt-list');
      var template = document.getElementById('prompt-template');
      var addButton = document.getElementById('prompt-add');
      var empty = document.getElementById('prompt-empty');

      function rows() { return list.querySelectorAll('.prompt-row'); }

      function refresh() {
        var all = rows();
        all.forEach(function (row, index) {
          row.querySelector('[data-prompt-move="up"]').disabled = index === 0;
          row.querySelector('[data-prompt-move="down"]').disabled = index === all.length - 1;
          count(row);
        });
        // Saving is refused past the limit anyway; disabling the button says so
        // before the round trip instead of after it.
        addButton.disabled = all.length >= ${PROMPT_SLOTS};
        empty.hidden = all.length > 0;
      }

      function count(row) {
        var input = row.querySelector('.prompt-text');
        var label = row.querySelector('.prompt-count');
        var used = input.value.trim().length;
        label.textContent = used + '/' + ${PROMPT_MAX_LENGTH};
        label.className = 'prompt-count muted' + (used >= ${PROMPT_MAX_LENGTH} ? ' full' : '');
      }

      list.addEventListener('input', function (e) {
        var row = e.target.closest('.prompt-row');
        if (row) { count(row); }
      });

      list.addEventListener('click', function (e) {
        var move = e.target.closest('[data-prompt-move]');
        if (move) {
          var row = move.closest('.prompt-row');
          if (move.getAttribute('data-prompt-move') === 'up' && row.previousElementSibling) {
            list.insertBefore(row, row.previousElementSibling);
          } else if (move.getAttribute('data-prompt-move') === 'down' && row.nextElementSibling) {
            list.insertBefore(row.nextElementSibling, row);
          }
          refresh();
          return;
        }
        if (e.target.closest('[data-prompt-remove]')) {
          e.target.closest('.prompt-row').remove();
          refresh();
        }
      });

      addButton.addEventListener('click', function () {
        list.appendChild(template.content.cloneNode(true));
        refresh();
        var all = rows();
        all[all.length - 1].querySelector('.prompt-text').focus();
      });

      refresh();

      // An empty row is a row someone added and did not fill, not a question.
      // The schema refuses a blank, so dropping them here is the difference
      // between saving and a 400 naming a field the user cannot see.
      return function collect() {
        var out = [];
        rows().forEach(function (row) {
          var text = row.querySelector('.prompt-text').value.trim();
          if (text) { out.push(text); }
        });
        return out;
      };
    })();

    document.getElementById('ai-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      var cap = f.monthlyUsd.value.trim();
      saveProfile({
        ai: {
          model: f.model.value,
          tone: f.tone.value,
          length: f.length.value,
          customPrompts: askQuestions()
        },
        budget: { monthlyUsd: cap === '' ? null : Number(cap) }
      }, 'AI settings saved');
    });

    document.getElementById('analytics-form').addEventListener('submit', function (e) {
      e.preventDefault();
      saveProfile({ analytics: { enabled: e.target.analytics.checked } }, 'Saved');
    });

    document.getElementById('analytics-clear').addEventListener('click', function () {
      fetch('/api/usage/features', { method: 'DELETE', headers: authHeaders({ 'Accept': 'application/json' }) })
        .then(function (r) {
          if (!r.ok) { throw new Error('Could not delete those counters'); }
          toast('Counters deleted');
          setTimeout(function () { location.reload(); }, 600);
        })
        .catch(function (e) { toast(e.message, true); });
    });

    document.getElementById('key-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = e.target.elements['anthropic_api_key'];
      if (!input.value.trim()) { toast('Enter a key first', true); return; }
      fetch('/dashboard/settings', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }),
        body: 'anthropic_api_key=' + encodeURIComponent(input.value.trim())
      }).then(function (r) {
        if (!r.ok) { throw new Error('Save failed (' + r.status + ')'); }
        input.value = '';
        toast('API key saved');
        refresh();
      }).catch(function (e) { toast(e.message, true); });
    });

    document.getElementById('regen').addEventListener('click', function () {
      fetch('/dashboard/insight/regenerate', {
        method: 'POST', headers: authHeaders({ 'Accept': 'application/json' })
      }).then(function (r) {
        if (!r.ok) { throw new Error('Failed (' + r.status + ')'); }
        toast('Insight cleared - the next watch sync regenerates it');
      }).catch(function (e) { toast(e.message, true); });
    });

    document.getElementById('context-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target;
      fetch('/dashboard/context', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json', 'Accept': 'application/json' }),
        body: JSON.stringify({
          kind: form.kind.value,
          text: form.text.value,
          effective_to: form.effective_to.value || undefined
        })
      }).then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) { throw new Error(body.error || 'Could not save that'); }
          toast('Saved');
          form.text.value = '';
          form.effective_to.value = '';
          refresh();
        });
      }).catch(function (e) { toast(e.message, true); });
    });

    document.getElementById('copy-url').addEventListener('click', function () {
      var text = document.getElementById('setup-url').textContent;
      navigator.clipboard.writeText(text).then(
        function () { toast('URL copied'); },
        function () { toast('Copy failed - select it manually', true); }
      );
    });

    document.getElementById('run-selftest').addEventListener('click', loadSelfTest);

    refresh();
    setInterval(refresh, 5000);

    // Once on load. It costs one outbound request and answers the question a
    // user arriving here most often has -- and it is deliberately NOT on the 5s
    // refresh, because hitting the public URL twelve times a minute forever is
    // how you get rate limited by your own tunnel.
    loadSelfTest();
  </script>
</body>
</html>`;
}

export function renderPairSuccess(code: string, token?: string): string {
  const back = token ? `/dashboard?token=${encodeURIComponent(token)}` : "/dashboard";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Paired</title>
  <style>body{font-family:ui-sans-serif,system-ui,sans-serif;background:${PALETTE.ground};color:${PALETTE.ink};
  display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;padding:24px;text-align:center;}
  .mark{font-size:2.6rem;color:${PALETTE.good};} p{color:${PALETTE.muted};} a{color:${PALETTE.series};}</style></head>
  <body><div class="mark">&#10003;</div><p>Watch code <strong style="color:${PALETTE.ink}">${escapeHtml(code)}</strong> approved. Your watch will connect shortly.</p>
  <a href="${escapeHtml(back)}">&larr; Back to dashboard</a></body></html>`;
}

export function renderPairError(msg: string, token?: string): string {
  const back = token ? `/dashboard?token=${encodeURIComponent(token)}` : "/dashboard";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Error</title>
  <style>body{font-family:ui-sans-serif,system-ui,sans-serif;background:${PALETTE.ground};color:${PALETTE.ink};
  display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;padding:24px;text-align:center;}
  .mark{font-size:2.6rem;color:${PALETTE.hard};} p{color:${PALETTE.muted};} a{color:${PALETTE.series};}</style></head>
  <body><div class="mark">&#10007;</div><p>${escapeHtml(msg)}</p>
  <a href="${escapeHtml(back)}">&larr; Back to dashboard</a></body></html>`;
}

export { CARD_IDS };
