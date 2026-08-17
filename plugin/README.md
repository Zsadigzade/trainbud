# TrainBud — Claude Code plugin

Installs skills + MCP server for Garmin Connect fitness data.

## Install

```bash
/plugin marketplace add Zsadigzade/trainbud
/plugin install trainbud@trainbud
```

Or from a local clone:

```bash
/plugin marketplace add /path/to/trainbud
/plugin install trainbud@trainbud
```

## Credentials

Set before enabling the plugin:

```bash
export GARMIN_EMAIL="your@email.com"
export GARMIN_PASSWORD="yourpassword"
```

Garmin Connect **MFA must be disabled**.

## Slash commands

| Command | Purpose |
|---------|---------|
| `/trainbud:trainbud-setup` | First-time setup and diagnostics |
| `/trainbud:trainbud` | Ask about workouts, sleep, recovery, etc. |

## MCP

The plugin starts the MCP server via the `trainbud` CLI. Install it once:

```bash
npm install -g trainbud          # after npm publish
# or from source:
git clone https://github.com/Zsadigzade/trainbud.git
cd trainbud && npm install && npm run build && npm link
```

Then restart Claude Code.

## Unofficial disclaimer

Not affiliated with Garmin Ltd. Uses unofficial Garmin Connect APIs.
