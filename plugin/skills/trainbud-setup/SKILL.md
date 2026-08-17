---
name: garmin-bud-setup
description: >-
  First-time GarminBud setup — credentials, Garmin Connect auth, MCP verification.
  Use when the user runs /garmin-bud:garmin-bud-setup, asks to connect Garmin,
  set up GarminBud, or fix MCP connection.
disable-model-invocation: true
---

# GarminBud setup

Guide one-time setup. GarminBud is unofficial — not affiliated with Garmin Ltd.

## Prerequisites

- Node.js 20+
- Garmin Connect account with synced device data
- **MFA disabled** on Garmin Connect

## Current state

!`node -v 2>&1; echo ---; if command -v garmin-bud >/dev/null 2>&1; then garmin-bud status 2>&1; else echo "garmin-bud CLI not on PATH"; fi`

## Plugin MCP credentials

This plugin's MCP server reads credentials from environment variables:

```bash
export GARMIN_EMAIL="your@email.com"
export GARMIN_PASSWORD="yourpassword"
```

Set these in your shell profile or Claude Code environment **before** enabling the plugin. Restart Claude Code after setting them.

Alternatively, run the setup wizard (creates `.env` in the current project):

```bash
npx garmin-bud setup
```

## Setup workflow

1. **Set credentials** (env vars above, or run setup wizard).

2. **Install CLI** (pick one):
   ```bash
   npm install -g garmin-bud          # after npm publish
   # or from source:
   git clone https://github.com/Zsadigzade/garmin-bud.git && cd garmin-bud
   npm install && npm run build && npm link
   ```

3. **Verify** all 9 tools:
   ```bash
   garmin-bud check
   ```

4. **Enable plugin** if not already: `/plugin install garmin-bud@garmin-bud`

5. **Restart Claude Code**, then run `/garmin-bud:garmin-bud`.

## If setup fails

| Symptom | Fix |
|---------|-----|
| Auth error | MFA off; run `garmin-bud auth` |
| MCP tools missing | Check env vars; restart Claude Code |
| `npx garmin-bud` fails | Run `npm link` from cloned repo, or `npm install -g garmin-bud` |
| Stale data | `garmin-bud cache clear` |

Do not commit `.env` or `.garmin/` credentials.
