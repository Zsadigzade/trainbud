---
name: garmin-bud
description: >-
  Answer questions about the user's Garmin Connect data — workouts, sleep, heart rate,
  recovery, stress, VO2 max, body composition, and training load. Use when the user
  runs /garmin-bud:garmin-bud or asks about Garmin stats, fitness, recovery, or training.
disable-model-invocation: true
---

# GarminBud — talk to your Garmin data

Use GarminBud MCP tools when the `garmin-bud` server is connected. Do not guess fitness data.

## Before fetching data

If MCP tools are unavailable, tell the user to run **`/garmin-bud:garmin-bud-setup`**, set `GARMIN_EMAIL` / `GARMIN_PASSWORD`, restart Claude Code, and try again.

## MCP tools (9)

| Tool | Use for |
|------|---------|
| `get_latest_activity` | Most recent workout |
| `get_activities_range` | Activities between ISO dates |
| `get_sleep_data` | Sleep duration, stages, score |
| `get_heart_rate_trends` | Resting/max/average HR trends |
| `get_recovery_status` | Composite recovery score |
| `get_body_composition` | Weight, body fat, muscle trends |
| `get_stress_levels` | Daily stress averages |
| `get_vo2_max_trends` | VO2 max fitness trends |
| `get_training_insights` | Combined weekly summary |

## How to respond

1. **Pick the right tool(s)** — prefer compound queries for training decisions.
2. **Sensible defaults** — 7 nights sleep, 30 days HR/VO2, today/yesterday for activities.
3. **Plain English** — friendly coach tone, not raw JSON.
4. **Honest about gaps** — body comp often empty.

## User intent → tools

| User asks… | Tools |
|------------|-------|
| Recent workouts | `get_latest_activity`, `get_activities_range` |
| Sleep | `get_sleep_data` |
| Recovered / train hard? | `get_recovery_status`, `get_sleep_data`, `get_stress_levels` |
| HR trend | `get_heart_rate_trends` |
| Weight / body comp | `get_body_composition` |
| Stress / overtraining | `get_stress_levels`, `get_training_insights` |
| VO2 max / fitness | `get_vo2_max_trends` |
| Weekly summary | `get_training_insights` |

## Example prompts

See [prompts.md](prompts.md). Natural language works too:

- "What did I do today?"
- "Am I recovered enough to train hard tomorrow?"

## Diagnostics

```bash
garmin-bud check
garmin-bud cache clear
```
