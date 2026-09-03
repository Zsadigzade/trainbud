---
name: trainbud-setup
description: >-
  First-time TrainBud setup — credentials, Garmin Connect auth, MCP verification.
  Use when the user runs /trainbud:trainbud-setup, asks to connect Garmin,
  set up TrainBud, or fix MCP connection.
disable-model-invocation: true
---

# TrainBud setup

Guide one-time setup. TrainBud is unofficial — not affiliated with Garmin Ltd.

## Prerequisites

- Node.js 20+
- Garmin Connect account with synced device data
- **MFA disabled** on Garmin Connect

## Current state

!`node -v 2>&1; echo ---; if command -v trainbud >/dev/null 2>&1; then trainbud status 2>&1; else echo "trainbud CLI not on PATH"; fi`

## Plugin MCP credentials

This plugin's MCP server reads credentials from environment variables:

```bash
export GARMIN_EMAIL="your@email.com"
export GARMIN_PASSWORD="yourpassword"
```

Set these in your shell profile or Claude Code environment **before** enabling the plugin. Restart Claude Code after setting them.

Alternatively, run the setup wizard (creates `.env` in the current project):

```bash
trainbud setup
```

(needs the CLI installed — see below. TrainBud is not on npm, so `npx trainbud`
resolves nothing.)

## Setup workflow

1. **Set credentials** (env vars above, or run setup wizard).

2. **Install CLI** (pick one):
   ```bash
   # TrainBud is NOT on the npm registry yet: `npm view trainbud` returns 404,
   # so `npm install -g trainbud` and `npx trainbud` cannot work, and would run
   # someone else's package if that name is ever claimed. Install from source:
   git clone https://github.com/Zsadigzade/trainbud.git && cd trainbud
   npm install && npm run build && npm link
   ```

3. **Verify** all 9 tools:
   ```bash
   trainbud check
   ```

4. **Enable plugin** if not already: `/plugin install trainbud@trainbud`

5. **Restart Claude Code**, then run `/trainbud:trainbud`.

## If setup fails

| Symptom | Fix |
|---------|-----|
| Auth error | MFA off; run `trainbud auth` |
| MCP tools missing | Check env vars; restart Claude Code |
| `trainbud: command not found` | Run `npm link` from the clone, or use `node dist/index.js <command>` |
| Stale data | `trainbud cache clear` |

Do not commit `.env` or `.trainbud/` credentials.
