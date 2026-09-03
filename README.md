# TrainBud

**Talk to your training data.**

TrainBud is an open-source MCP server that connects your Garmin Connect fitness data to Claude, Cursor, and other AI assistants. Ask about workouts, sleep, heart rate, recovery, and body composition in plain English — privately, on your machine.

> **Disclaimer:** TrainBud is an unofficial community project. It is not affiliated with, endorsed by, or sponsored by Garmin Ltd. Garmin Connect is a trademark of Garmin Ltd.

[![CI](https://github.com/Zsadigzade/trainbud/actions/workflows/ci.yml/badge.svg)](https://github.com/Zsadigzade/trainbud/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node 20+](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](.nvmrc)

## Try it

Once connected to your MCP client, ask things like:

- *"What did I do today?"*
- *"How's my sleep been this week?"*
- *"Am I recovered enough to train hard tomorrow?"*
- *"Is my resting heart rate trending down?"*

See [examples/prompts.md](./examples/prompts.md) for more ideas.

## Why TrainBud

- **Private** — credentials stay in your local `.env`; data is cached on your machine
- **Local-first** — SQLite cache, session tokens in `.trainbud/`
- **Works everywhere** — Windows, macOS, Linux (Node.js 20+)
- **Any MCP client** — Claude Desktop, Cursor, and other stdio-compatible clients
- **Smart fetching** — batched API calls and automatic re-auth when sessions expire

## Quick start

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

The setup wizard walks you through credentials, authentication, and connecting Cursor or Claude Desktop — no MCP config editing required.

Full walkthrough: [QUICKSTART.md](./QUICKSTART.md)

## Claude Code plugin (recommended)

Install as a [Claude Code plugin](https://code.claude.com/docs/en/plugins) — skills **and** MCP server in one step:

```bash
/plugin marketplace add Zsadigzade/trainbud
/plugin install trainbud@trainbud
```

Set credentials, then restart Claude Code:

```bash
export GARMIN_EMAIL="your@email.com"
export GARMIN_PASSWORD="yourpassword"
```

| Command | What it does |
|---------|----------------|
| `/trainbud:trainbud-setup` | First-time setup and diagnostics |
| `/trainbud:trainbud` | Ask about workouts, sleep, recovery, HR, stress, VO2 max |

Plugin files live in [`plugin/`](./plugin/). See [`plugin/README.md`](./plugin/README.md).

## Claude Code skills (in-repo)

This repo also ships project skills in [`.claude/skills/`](./.claude/skills/) for development without installing the plugin:

| Command | What it does |
|---------|----------------|
| `/trainbud-setup` | Install, authenticate, configure MCP, run live check |
| `/trainbud` | Ask about workouts, sleep, recovery, HR, stress, VO2 max |

Open the repo in **Claude Code** (`claude` in this directory) — skills load automatically.

To use skills in **every** project without the plugin, copy them to `~/.claude/skills/`.

After setup, restart your MCP client and try `/trainbud` with *"What did I do today?"*

## Dashboard

`trainbud serve` hosts a dashboard at `/dashboard`. It is phone-first, because the
pairing flow is: you are standing next to the watch holding a phone when you approve a
code.

It shows what stands out today against your own baselines, this week against last week,
and resting heart rate and sleep plotted against your own 30-day median — all read from
the local history store, so it paints instantly and works even when your Connect session
has expired. **A break in a line is a day with no measurement, not a zero.**

It is also where you tell TrainBud who it is talking to:

| Setting | What it changes |
|---|---|
| Name, units, primary sport, weekly goal | Every renderer, and what the AI is told about you |
| Thresholds | Where green becomes amber and amber becomes red — on the watch too |
| Watch cards | Which cards appear on the wrist and in what order, live on the next sync |
| AI model, tone, answer length | How the Ask card and the daily insight sound |
| Monthly spending cap | Optional. Refuses an Ask past the cap instead of spending past it |
| Privacy | Local feature counters, on by default, with a delete button |

**Usage.** TrainBud runs on your own AI provider key, so every question and every daily
insight is charged to you. The dashboard shows the tokens and cost per call, the month to
date, and a 30-day chart. A model this build has no published price for is recorded with
its cost left *unknown* rather than as zero — a call priced at zero would make a cap that
can never trip.

Nothing on this page leaves your machine. There is no endpoint to send it to.

## Garmin watch widget (Connect IQ)

View recovery, sleep, activity, stress, and VO2 max on your Garmin watch via a Connect IQ widget in [`ciq/`](./ciq/).

**Requires:** `trainbud serve` running + HTTPS tunnel (same setup as web AI).

1. Start the server and tunnel:
   ```bash
   trainbud serve
   cloudflared tunnel --url http://127.0.0.1:3847
   ```
2. Build and sideload the widget — see [ciq/README.md](./ciq/README.md)
3. In **Garmin Connect Mobile** → Connect IQ → TrainBud settings, set:
   - **Server URL** — your tunnel URL (e.g. `https://abc.trycloudflare.com`)
4. Open the widget on your watch — it shows a pairing code. Approve it in the dashboard (`/dashboard?token=YOUR_API_KEY`) to complete setup.

The glance shows recovery and sleep from the last cached summary, so it renders without
waiting on the network. Open it and tap or swipe to cycle through seven cards. The watch
calls `GET /api/watch` — a compact JSON summary, not the full MCP protocol.

## Connect to Claude Desktop

Edit `claude_desktop_config.json`:

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`  
**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

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

After `npm link`, you can use the CLI directly:

```json
{
  "mcpServers": {
    "trainbud": {
      "command": "trainbud",
      "args": ["start"]
    }
  }
}
```

Restart your MCP client, then start asking questions.

## Tools

| Tool | What it answers |
|------|-----------------|
| `get_latest_activity` | Your most recent workout — distance, pace, HR, elevation |
| `get_activities_range` | Activities between two dates |
| `get_sleep_data` | Sleep duration, stages, score, awakenings |
| `get_heart_rate_trends` | Resting, max, and average HR over time |
| `get_recovery_status` | Recovery score from HRV, sleep, stress, resting HR |
| `get_body_composition` | Weight, body fat, and muscle mass trends |
| `get_stress_levels` | Daily stress averages and trends |
| `get_vo2_max_trends` | VO2 max fitness trends over time |
| `get_training_insights` | Combined weekly summary (activities, sleep, recovery, stress) |
| `get_findings` | What stands out against **your own** 28-day baselines, not a population average |
| `get_week_review` | This week against last, the load forecast, sleep debt, and your next race |
| `remember_context` | Record a goal, a race and its date, an injury, or a note |
| `get_user_context` | What is on record about you, on any date |
| `log_subjective` | How a session actually felt — RPE, soreness, mood |

## CLI

```bash
trainbud setup          # Interactive first-time setup (recommended)
trainbud serve          # Remote HTTP MCP for web AI (claude.ai, ChatGPT)
trainbud check          # Live diagnostics against all tools
trainbud doctor         # What the watch would see: public URL, AI key, history depth
trainbud backfill       # Pull Garmin history into the local store (resumable)
trainbud findings       # What stands out against your own baselines
trainbud start          # Start the MCP server (stdio)
trainbud auth           # Force re-authentication
trainbud cache clear    # Clear cached data
trainbud status         # Show session and cache status
trainbud --version      # Print version
```

These need `npm link` (see Quick start). From a clone without it, the same
commands are `node dist/index.js <command>` — e.g. `node dist/index.js backfill`.

### Troubleshooting: `trainbud: command not found`

TrainBud is not on the npm registry, so nothing puts the command on your PATH by
itself. Either run `npm link` once from the repo root, or call the built entry
point directly:

```bash
node dist/index.js doctor
```

If `dist/` does not exist yet, run `npm run build` first.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GARMIN_EMAIL` | — | Garmin Connect email |
| `GARMIN_PASSWORD` | — | Garmin Connect password |
| `TRAINBUD_SESSION_PATH` | `.trainbud/session.json` | Session token storage |
| `TRAINBUD_LOG_PATH` | `.trainbud/mcp.log` | Log file path |
| `TRAINBUD_CACHE_PATH` | `.trainbud/cache.db` | SQLite cache database |
| `CACHE_TTL_ACTIVITIES` | `1800` | Activity cache TTL (seconds) |
| `CACHE_TTL_SLEEP` | `7200` | Sleep cache TTL (seconds) |
| `CACHE_TTL_STATS` | `3600` | Stats cache TTL (seconds) |
| `TRAINBUD_API_KEY` | auto-generated | Bearer token for HTTP MCP (`trainbud serve`) |
| `TRAINBUD_HOST` | `127.0.0.1` | Bind host for HTTP server |
| `TRAINBUD_PORT` | `3847` | Bind port for HTTP server |

## Security & privacy

- Credentials live only in your local `.env` file — never sent to a third party
- Session tokens in `.trainbud/session.json` are as sensitive as a password
- Tool errors are sanitized before reaching the AI client
- Uses the unofficial [`garmin-connect`](https://www.npmjs.com/package/garmin-connect) npm package (not Garmin's enterprise OAuth API)
- **MFA is not supported** by the underlying library — disable MFA or use an app-specific password

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Authentication failed | Verify `.env` credentials, run `trainbud auth` |
| MFA enabled on account | Disable MFA or use an app-specific password |
| Stale data | Run `trainbud cache clear` |
| Rate limited | Wait 60 seconds; cached responses are used when available |
| Watch shows "Not a TrainBud server" or error -400 | Your public URL is answering with something that is not TrainBud's JSON — usually a tunnel that is down. Run `trainbud doctor`; it says exactly what came back |
| Watch shows "Watch not authorised" | The API key changed since the watch paired. Pair it again from the dashboard |
| Watch shows "AI not set up" | AI is bring-your-own-key. Paste an Anthropic key into the dashboard |
| No sleep/HR data | Ensure your Garmin device has synced to Garmin Connect |
| Server won't start | Check that `GARMIN_EMAIL` and `GARMIN_PASSWORD` are set in `.env` |

## Development

```bash
npm install
npm run build
npm test          # 33 tests via Node test runner
npm run lint
npm run dev       # Start with auto-reload
```

Use `.nvmrc` with nvm/fnm for Node 20. If your project path contains `#`, use `npm test` instead of `npm run test:vitest`.

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [docs/VAULT.md](./docs/VAULT.md) for architecture and design notes (Obsidian vault, outside this repo).

## Roadmap

- [x] VO2 max trends
- [x] Stress levels
- [x] Training insights
- [ ] Workout comparison
- [ ] Docker image

## License

MIT — see [LICENSE](./LICENSE).

Garmin Connect is a trademark of Garmin Ltd. This project is not affiliated with Garmin Ltd.
