import { getPendingPairings } from "./pairApi.js";
import { activeContext } from "./history/context.js";
import { CONTEXT_KINDS } from "./history/schema.js";
import { DateTime } from "luxon";
import { appConfig } from "./config.js";
import { isAiConfigured, getCachedDailyInsight } from "./promptApi.js";

// SECTION: HTML Dashboard
//
// Everything the browser needs after first paint is fetched from
// /dashboard/status with the token sent as a Bearer header, so the page no
// longer reloads itself every ten seconds. The old full-page reload discarded
// whatever you had typed into the API key field if it fired mid-entry.

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface DashboardContextRow {
  id: number;
  kind: string;
  text: string;
  effective_from: string;
  effective_to: string | null;
}

export interface DashboardStatus {
  pending: { code: string; expires_in: number }[];
  ai_configured: boolean;
  insight: string | null;
  public_url: string;
  context: DashboardContextRow[];
}

export function getDashboardStatus(): DashboardStatus {
  const now = Math.floor(Date.now() / 1000);
  return {
    pending: getPendingPairings().map((t) => ({
      code: t.code,
      expires_in: Math.max(0, t.expires_at - now),
    })),
    ai_configured: isAiConfigured(),
    insight: getCachedDailyInsight(),
    public_url: appConfig.publicUrl,
    context: activeContext(DateTime.local().toISODate() ?? "").map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      text: entry.text,
      effective_from: entry.effectiveFrom,
      effective_to: entry.effectiveTo,
    })),
  };
}

export function renderDashboard(): string {
  const status = getDashboardStatus();
  const serverUrl = status.public_url || `http://localhost:${appConfig.mcpPort}`;
  const tunnelConfigured = status.public_url.length > 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TrainBud Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0d1220; color: #e6edf5; min-height: 100vh; padding: 24px; line-height: 1.5; }
    .wrap { max-width: 560px; margin: 0 auto; }
    h1 { font-size: 1.4rem; color: #fff; }
    .subtitle { color: #6b7a90; font-size: 0.85rem; margin-bottom: 28px; }
    h2 { font-size: 0.78rem; color: #8fa3bd; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px; }
    .section { background: #141c2e; border: 1px solid #22304a; border-radius: 10px; padding: 20px; margin-bottom: 20px; }
    .pair-card { display: flex; align-items: center; gap: 16px; padding: 12px; background: #0d1220; border-radius: 8px; margin-bottom: 8px; flex-wrap: wrap; }
    .code { font-size: 2rem; font-weight: 700; letter-spacing: 0.3em; color: #fff; font-variant-numeric: tabular-nums; }
    .muted { color: #6b7a90; font-size: 0.82rem; }
    button { border: none; border-radius: 6px; padding: 8px 18px; font-size: 0.9rem; cursor: pointer; color: #fff; }
    .btn-approve { background: #2563eb; }
    .btn-approve:hover { background: #1d4ed8; }
    .btn-save { background: #16a34a; }
    .btn-save:hover { background: #15803d; }
    .btn-ghost { background: #22304a; }
    .btn-ghost:hover { background: #2d3f60; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid #1c2740; }
    .row:last-child { border-bottom: none; }
    .row .label { color: #8fa3bd; font-size: 0.85rem; }
    .ok { color: #3ddc84; font-size: 0.85rem; }
    .warn { color: #f5a623; font-size: 0.85rem; }
    input[type=password] { background: #0d1220; border: 1px solid #2a3a57; color: #e6edf5; border-radius: 6px; padding: 9px 12px; width: 100%; font-size: 0.9rem; }
    input[type=password]:focus { outline: 2px solid #2563eb; }
    .info { font-size: 0.82rem; color: #6b7a90; margin-top: 8px; }
    .alert { background: #16203a; border: 1px solid #22304a; border-radius: 6px; padding: 10px 14px; font-size: 0.85rem; color: #8fa3bd; margin-top: 12px; }
    code { color: #7cc4ff; font-family: ui-monospace, monospace; word-break: break-all; }
    pre { background: #0d1220; border: 1px solid #22304a; border-radius: 6px; padding: 12px; overflow-x: auto; font-size: 0.8rem; color: #b8c7db; }
    .toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: 24px; background: #16a34a; color: #fff; padding: 10px 20px; border-radius: 8px; font-size: 0.9rem; opacity: 0; transition: opacity .2s; pointer-events: none; }
    .toast.show { opacity: 1; }
    .toast.err { background: #dc2626; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>TrainBud</h1>
    <p class="subtitle">Dashboard · <code>${escapeHtml(serverUrl)}</code></p>

    <div class="section">
      <h2>Status</h2>
      <div class="row">
        <span class="label">Public URL</span>
        <span class="${tunnelConfigured ? "ok" : "warn"}">${tunnelConfigured ? "configured" : "not set"}</span>
      </div>
      <div class="row">
        <span class="label">AI features</span>
        <span id="ai-status" class="${status.ai_configured ? "ok" : "warn"}">${status.ai_configured ? "enabled" : "no API key"}</span>
      </div>
      <div class="row">
        <span class="label">Today's insight</span>
        <span id="insight-status" class="muted">${status.insight ? "cached" : "not generated yet"}</span>
      </div>
      ${tunnelConfigured ? "" : `<div class="alert">Set <code>TRAINBUD_PUBLIC_URL</code> in .env, or run <code>scripts/start-watch-stack.ps1</code>, so the watch has a URL to reach.</div>`}
    </div>

    <div class="section">
      <h2>Watch pairing</h2>
      <div id="pairing"></div>
      <div class="alert">Open TrainBud on your watch — it shows a 6-digit code — then approve it here.</div>
    </div>

    <div class="section">
      <h2>AI provider key</h2>
      <form id="key-form" autocomplete="off">
        <input type="password" name="anthropic_api_key" placeholder="sk-ant-..." autocomplete="off">
        <p class="info">Stored locally in <code>.trainbud/app.db</code>, never sent anywhere except the provider. Leave blank to keep the existing key.</p>
        <div style="margin-top:12px;display:flex;gap:8px;">
          <button type="submit" class="btn-save">Save</button>
          <button type="button" id="regen" class="btn-ghost">Regenerate today's insight</button>
        </div>
      </form>
    </div>

    <div class="section">
      <h2>About you</h2>
      <p class="muted">Garmin measures you. It has no idea what you are training for, or what hurts — and that is what makes a finding worth anything.</p>
      <div id="context"></div>
      <form id="context-form" autocomplete="off" style="margin-top:12px;">
        <select name="kind">
          ${CONTEXT_KINDS.map((kind) => `<option value="${kind}">${kind}</option>`).join("")}
        </select>
        <input type="text" name="text" placeholder="Half marathon, Oct 12" maxlength="200" required>
        <input type="date" name="effective_to" title="Optional: when this stops being true">
        <button type="submit" class="btn-save">Add</button>
      </form>
    </div>

    <div class="section">
      <h2>Watch setup</h2>
      <p class="muted">In the Connect IQ app → TrainBud → settings, set Server URL to:</p>
      <pre id="setup-url">${escapeHtml(serverUrl)}</pre>
      <button type="button" id="copy-url" class="btn-ghost" style="margin-top:10px;">Copy URL</button>
    </div>
  </div>

  <div id="toast" class="toast"></div>

  <script>
    // The page is reached with ?token=..., and every endpoint below accepts that
    // same value as a Bearer token. Keeping it in memory means links and form
    // posts no longer have to carry it in the URL — the old redirect after
    // saving dropped it and landed on a 401.
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
      setTimeout(function () { el.className = 'toast'; }, 2600);
    }

    function renderPairing(pending) {
      var host = document.getElementById('pairing');
      if (!pending.length) {
        host.innerHTML = '<p class="muted">No pending pairing requests.</p>';
        return;
      }
      host.innerHTML = pending.map(function (p) {
        var mins = Math.floor(p.expires_in / 60);
        var secs = p.expires_in % 60;
        var left = p.expires_in <= 0 ? 'expired' : (mins > 0 ? mins + 'm ' + secs + 's' : secs + 's');
        return '<div class="pair-card">' +
          '<div class="code">' + p.code + '</div>' +
          '<div class="muted">Expires in ' + left + '</div>' +
          '<button class="btn-approve" data-code="' + p.code + '">Approve</button>' +
          '</div>';
      }).join('');

      Array.prototype.forEach.call(host.querySelectorAll('button[data-code]'), function (btn) {
        btn.addEventListener('click', function () { approve(btn.getAttribute('data-code')); });
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

    function refresh() {
      fetch('/dashboard/status', { headers: authHeaders({ 'Accept': 'application/json' }) })
        .then(function (r) {
          if (!r.ok) { throw new Error('status ' + r.status); }
          return r.json();
        })
        .then(function (s) {
          renderPairing(s.pending);
          renderContext(s.context);
          renderContext(s.context);
          var ai = document.getElementById('ai-status');
          ai.textContent = s.ai_configured ? 'enabled' : 'no API key';
          ai.className = s.ai_configured ? 'ok' : 'warn';
          document.getElementById('insight-status').textContent =
            s.insight ? 'cached' : 'not generated yet';
        })
        .catch(function () { /* transient — next tick retries */ });
    }

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
        method: 'POST',
        headers: authHeaders({ 'Accept': 'application/json' })
      }).then(function (r) {
        if (!r.ok) { throw new Error('Failed (' + r.status + ')'); }
        toast('Insight cleared — next watch sync regenerates it');
        refresh();
      }).catch(function (e) { toast(e.message, true); });
    });

    function renderContext(entries) {
      var host = document.getElementById('context');
      if (!entries || entries.length === 0) {
        host.innerHTML = '<p class="muted">Nothing on record yet.</p>';
        return;
      }
      // textContent on every value: this is the user's own text coming back
      // from the store, and innerHTML here would execute whatever it contains.
      host.innerHTML = '';
      entries.forEach(function (entry) {
        var row = document.createElement('div');
        row.className = 'alert';
        var label = document.createElement('span');
        label.textContent = entry.kind + ': ' + entry.text +
          (entry.effective_to ? ' (until ' + entry.effective_to + ')' : '');
        var close = document.createElement('button');
        close.className = 'btn-ghost';
        close.style.marginLeft = '10px';
        close.textContent = 'Done';
        close.addEventListener('click', function () { closeContext(entry.id); });
        row.appendChild(label);
        row.appendChild(close);
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

    function renderContext(entries) {
      var host = document.getElementById('context');
      if (!entries || entries.length === 0) {
        host.innerHTML = '<p class="muted">Nothing on record yet.</p>';
        return;
      }
      // textContent for every value: this is the user's own text coming back
      // out of the store, and innerHTML here would run whatever it contains.
      host.innerHTML = '';
      entries.forEach(function (entry) {
        var row = document.createElement('div');
        row.className = 'alert';
        var label = document.createElement('span');
        label.textContent = entry.kind + ': ' + entry.text +
          (entry.effective_to ? ' (until ' + entry.effective_to + ')' : '');
        var close = document.createElement('button');
        close.className = 'btn-ghost';
        close.style.marginLeft = '10px';
        close.textContent = 'Done';
        close.addEventListener('click', function () { closeContext(entry.id); });
        row.appendChild(label);
        row.appendChild(close);
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
        function () { toast('Copy failed — select it manually', true); }
      );
    });

    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>`;
}

export function renderPairSuccess(code: string, token?: string): string {
  const back = token ? `/dashboard?token=${encodeURIComponent(token)}` : "/dashboard";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Paired</title>
  <style>body{font-family:system-ui;background:#0d1220;color:#e6edf5;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;}
  .ok{font-size:3rem;color:#3ddc84;} p{color:#8fa3bd;} a{color:#7cc4ff;}</style></head>
  <body><div class="ok">&#10003;</div><p>Watch code <strong>${escapeHtml(code)}</strong> approved. Your watch will connect shortly.</p>
  <a href="${escapeHtml(back)}">&larr; Back to dashboard</a></body></html>`;
}

export function renderPairError(msg: string, token?: string): string {
  const back = token ? `/dashboard?token=${encodeURIComponent(token)}` : "/dashboard";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Error</title>
  <style>body{font-family:system-ui;background:#0d1220;color:#e6edf5;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;}
  .err{font-size:3rem;color:#f87171;} p{color:#8fa3bd;} a{color:#7cc4ff;}</style></head>
  <body><div class="err">&#10007;</div><p>${escapeHtml(msg)}</p>
  <a href="${escapeHtml(back)}">&larr; Back to dashboard</a></body></html>`;
}
