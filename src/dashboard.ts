import { getSetting } from "./appDb.js";
import { getPendingPairings } from "./pairApi.js";
import { appConfig } from "./config.js";

// SECTION: HTML Dashboard

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatSecondsLeft(expiresAt: number): string {
  const secs = expiresAt - Math.floor(Date.now() / 1000);
  if (secs <= 0) return "expired";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function renderDashboard(): string {
  const pendingPairs = getPendingPairings();
  const anthropicKeySet = !!getSetting("anthropic_api_key") || !!appConfig.anthropicApiKey;
  const serverUrl = appConfig.publicUrl || `http://localhost:${appConfig.mcpPort}`;

  const pairingSection = pendingPairs.length === 0
    ? `<p class="muted">No pending pairing requests. Open TrainBud on your watch to generate a code.</p>`
    : pendingPairs.map((t) => `
        <div class="pair-card">
          <div class="code">${escapeHtml(t.code)}</div>
          <div class="muted">Expires in ${formatSecondsLeft(t.expires_at)}</div>
          <form method="POST" action="/dashboard/pair/approve">
            <input type="hidden" name="code" value="${escapeHtml(t.code)}">
            <button type="submit" class="btn-approve">Approve</button>
          </form>
        </div>`).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TrainBud Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #e0e0e0; min-height: 100vh; padding: 24px; }
    h1 { font-size: 1.4rem; color: #fff; margin-bottom: 4px; }
    .subtitle { color: #666; font-size: 0.85rem; margin-bottom: 32px; }
    h2 { font-size: 1rem; color: #aaa; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }
    .section { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 10px; padding: 20px; margin-bottom: 24px; max-width: 540px; }
    .pair-card { display: flex; align-items: center; gap: 16px; padding: 12px; background: #111; border-radius: 8px; margin-bottom: 8px; flex-wrap: wrap; }
    .code { font-size: 2rem; font-weight: 700; letter-spacing: 0.3em; color: #fff; font-variant-numeric: tabular-nums; }
    .muted { color: #555; font-size: 0.82rem; }
    .btn-approve { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 8px 18px; font-size: 0.9rem; cursor: pointer; }
    .btn-approve:hover { background: #1d4ed8; }
    .status-ok { color: #22c55e; font-size: 0.85rem; }
    .status-missing { color: #f59e0b; font-size: 0.85rem; }
    input[type=text], input[type=password] { background: #111; border: 1px solid #333; color: #e0e0e0; border-radius: 6px; padding: 8px 12px; width: 100%; font-size: 0.9rem; margin-bottom: 10px; }
    input[type=text]:focus, input[type=password]:focus { outline: 2px solid #2563eb; }
    .btn-save { background: #16a34a; color: #fff; border: none; border-radius: 6px; padding: 8px 18px; font-size: 0.9rem; cursor: pointer; }
    .btn-save:hover { background: #15803d; }
    .info { font-size: 0.82rem; color: #555; margin-top: 6px; }
    .alert { background: #1f2937; border: 1px solid #374151; border-radius: 6px; padding: 10px 14px; font-size: 0.85rem; color: #9ca3af; margin-top: 12px; }
  </style>
</head>
<body>
  <h1>TrainBud</h1>
  <p class="subtitle">Dashboard · ${escapeHtml(serverUrl)}</p>

  <div class="section">
    <h2>Watch Pairing</h2>
    ${pairingSection}
    <div class="alert">Open TrainBud on your watch → it shows a 6-digit code → approve it here.</div>
  </div>

  <div class="section">
    <h2>Claude AI</h2>
    <p class="info" style="margin-bottom:12px;">
      Status: ${anthropicKeySet
        ? '<span class="status-ok">API key configured</span>'
        : '<span class="status-missing">Not configured</span>'}
    </p>
    <form method="POST" action="/dashboard/settings">
      <label style="font-size:0.85rem;color:#aaa;display:block;margin-bottom:6px;">Anthropic API Key</label>
      <input type="password" name="anthropic_api_key" placeholder="sk-ant-..." autocomplete="off">
      <p class="info">Leave blank to keep existing key. Get yours at console.anthropic.com</p>
      <button type="submit" class="btn-save" style="margin-top:10px;">Save</button>
    </form>
  </div>

  <div class="section">
    <h2>Server Info</h2>
    <p style="font-size:0.85rem;">Public URL: <code style="color:#60a5fa">${escapeHtml(serverUrl)}</code></p>
    <p class="info" style="margin-top:6px;">Set TRAINBUD_PUBLIC_URL in .env to your Cloudflare Tunnel URL for watch pairing.</p>
  </div>

  <script>
    // Auto-refresh every 10s so pairing codes appear without manual reload
    setTimeout(() => location.reload(), 10000);
  </script>
</body>
</html>`;
}

export function renderPairSuccess(code: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Paired</title>
  <style>body{font-family:system-ui;background:#0f0f0f;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;}
  .ok{font-size:3rem;} p{color:#aaa;} a{color:#60a5fa;}</style></head>
  <body><div class="ok">✓</div><p>Watch code <strong>${escapeHtml(code)}</strong> approved. Your watch will connect shortly.</p>
  <a href="/dashboard">← Back to dashboard</a></body></html>`;
}

export function renderPairError(msg: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Error</title>
  <style>body{font-family:system-ui;background:#0f0f0f;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;}
  .err{font-size:3rem;} p{color:#aaa;} a{color:#60a5fa;}</style></head>
  <body><div class="err">✗</div><p>${escapeHtml(msg)}</p>
  <a href="/dashboard">← Back to dashboard</a></body></html>`;
}
