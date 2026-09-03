# Quickstart

Get TrainBud running in about 5 minutes.

## Prerequisites

- Node.js 20 or newer ([`.nvmrc`](./.nvmrc) included)
- A Garmin Connect account with synced device data
- Garmin Connect **MFA disabled** (the underlying library does not support MFA yet)

## Recommended: one-command setup

```bash
git clone https://github.com/Zsadigzade/trainbud.git
cd trainbud
npm install
npm run build
npm link          # puts `trainbud` on your PATH
trainbud setup
```

> `npm link` is what makes the bare `trainbud` command work. Without it every
> `trainbud ...` line below is "command not found", because TrainBud is not on
> the npm registry — so `trainbud` does **not** work either, and would run
> whatever gets published under that name in future. If you would rather not
> link, every command works as `node dist/index.js <command>` from the repo root.
> Undo with `npm unlink -g trainbud`.

The setup wizard will:

1. Ask for your Garmin Connect email and password
2. Save credentials to `.env`
3. Authenticate with Garmin Connect
4. Detect Cursor and Claude Desktop on your machine
5. Offer to add TrainBud to your MCP client config automatically
6. Optionally run a live API check against all 9 tools

After setup, **restart your MCP client completely** (Cursor or Claude Desktop), then ask:

- "What did I do today?"
- "How's my sleep been this week?"
- "Am I recovered enough to train hard?"

### Claude Code: plugin or slash commands

**Plugin (recommended)** — skills + MCP in one install:

```bash
/plugin marketplace add Zsadigzade/trainbud
/plugin install trainbud@trainbud
```

Then `/trainbud:trainbud-setup` and `/trainbud:trainbud`.

**In-repo skills** — if you cloned the repo and run `claude` here:

1. `/trainbud-setup` — guided install + MCP config + live check
2. Restart MCP client
3. `/trainbud` — ask any fitness question

See [`plugin/README.md`](./plugin/README.md) for plugin details.

## Verify without an MCP client

After setup, you can confirm Garmin Connect access directly:

```bash
trainbud check
```

Example output:

```text
TrainBud live check

  get_latest_activity       ✓  Activity: Morning Run, Distance: 5.2 km, Start: ...
  get_activities_range      ✓  3 activities found
  get_sleep_data            ✓  7 nights retrieved
  get_heart_rate_trends     ✓  30-day trend loaded
  get_recovery_status       ✓  Score: 72 (Ready to train)
  get_body_composition      ✗  No body composition data found for the last 30 days.
  get_stress_levels         ✓  7-day stress trend loaded
  get_vo2_max_trends        ✓  30-day VO2 max trend loaded
  get_training_insights     ✓  Weekly summary generated

All 9 checks passed. TrainBud is ready to use.
```

## Manual setup (alternative)

If you prefer to configure files yourself:

### 1. Install

```bash
git clone https://github.com/Zsadigzade/trainbud.git
cd trainbud
npm install
```

### 2. Configure credentials

```bash
cp .env.example .env
```

Edit `.env`:

```env
GARMIN_EMAIL=your@email.com
GARMIN_PASSWORD=yourpassword
```

### 3. Build and authenticate

```bash
npm run build
trainbud auth
```

You should see: `Garmin authentication successful. Session saved.`

### 4. Connect to Cursor or Claude Desktop

**Cursor:** `%USERPROFILE%\.cursor\mcp.json` (Windows) or `~/.cursor/mcp.json` (macOS/Linux)

**Claude Desktop (Windows):** `%APPDATA%\Claude\claude_desktop_config.json`  
**Claude Desktop (macOS):** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "trainbud": {
      "command": "node",
      "args": ["C:/path/to/trainbud/dist/index.js", "start"],
      "env": {
        "GARMIN_EMAIL": "your@email.com",
        "GARMIN_PASSWORD": "yourpassword"
      }
    }
  }
}
```

Restart your MCP client.

## Web AI (claude.ai, ChatGPT)

For web AI platforms that require remote MCP connectors:

```bash
trainbud serve
```

Then expose via HTTPS tunnel and add to claude.ai Connectors. Full guide: [docs/WEB-MCP.md](./docs/WEB-MCP.md)

## Useful commands

```bash
trainbud setup         # Interactive first-time setup (recommended)
trainbud serve         # Remote HTTP MCP for web AI connectors
trainbud check         # Live diagnostics against all tools
trainbud status        # Check session + cache
trainbud cache clear   # Force fresh data fetch
trainbud auth          # Re-login if session expired
trainbud start         # Start MCP server manually (stdio)
```

## Troubleshooting setup

| Issue | Fix |
|-------|-----|
| Authentication failed | Verify email/password; disable MFA at connect.garmin.com |
| MCP client doesn't see tools | Restart the client completely (not just reload window) |
| Stale data | Run `trainbud cache clear` |
| `dist/index.js` not found | Run `npm run build` |

## Next steps

- [README.md](./README.md) — full reference
- [examples/prompts.md](./examples/prompts.md) — sample questions
- [docs/VAULT.md](./docs/VAULT.md) — architecture, branding, and design notes (Obsidian vault)
