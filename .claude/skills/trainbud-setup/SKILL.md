---
name: trainbud-setup
description: >-
  First-time TrainBud setup — install, authenticate Garmin Connect, configure MCP
  for Cursor or Claude Desktop, and verify all tools. Use when the user runs
  /trainbud-setup, asks to connect Garmin, set up TrainBud, or fix MCP connection.
disable-model-invocation: true
---

# TrainBud setup

Guide the user through one-time setup. TrainBud is an unofficial MCP server for Garmin Connect (not affiliated with Garmin Ltd.).

## Prerequisites (tell user if missing)

- Node.js 20+
- Garmin Connect account with synced device data
- **MFA disabled** on Garmin Connect (library limitation)

## Current state

!`node -v 2>&1; echo ---; if command -v trainbud >/dev/null 2>&1; then trainbud status 2>&1; else echo "trainbud CLI not on PATH"; fi`

## Setup workflow

1. **Install** (from repo root if cloned, or global after `npm install -g trainbud`):
   ```bash
   npm install && npm run build
   ```

2. **Run the wizard** (interactive — user must enter email/password in terminal):
   ```bash
   npx trainbud setup
   ```
   The wizard saves `.env`, authenticates, and offers to patch Cursor / Claude Desktop MCP config.

3. **Verify** all 9 tools against live Garmin data:
   ```bash
   npx trainbud check
   ```

4. **Restart MCP client completely** (Cursor or Claude Desktop), then test with `/trainbud`.

## If setup fails

| Symptom | Fix |
|---------|-----|
| Auth / login error | Confirm MFA is off; run `trainbud auth` |
| MCP tools missing | Re-run setup; confirm `dist/index.js` exists (`npm run build`) |
| Cursor Node ABI error | Match `node` in MCP config to system Node (`node -v`) |
| Stale data | `trainbud cache clear` |

## Web AI (claude.ai / ChatGPT)

After local setup works, run `trainbud serve` and expose via HTTPS tunnel. See repo `docs/WEB-MCP.md`.

Do not commit `.env` or `.trainbud/` credentials.
