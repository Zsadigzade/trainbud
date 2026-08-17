---
name: garmin-bud
description: >-
  Answer questions about the user's Garmin Connect data — workouts, sleep, heart rate,
  recovery, stress, VO2 max, body composition, and training load. Use when the user
  runs /garmin-bud or asks about their Garmin stats, fitness, recovery, or training.
disable-model-invocation: true
---

# GarminBud — talk to your Garmin data

You have access to GarminBud MCP tools when the `garmin-bud` server is connected. Use them — do not guess fitness data.

## Before fetching data

If MCP tools are unavailable, tell the user to run **`/garmin-bud-setup`** first, restart their MCP client, and try again.

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

1. **Pick the right tool(s)** — prefer compound queries (e.g. recovery + sleep + activities for "should I train hard tomorrow?").
2. **Call tools with sensible defaults** — last 7 nights for sleep, 30 days for HR/VO2, today/yesterday for activities.
3. **Summarize in plain English** — friendly coach tone, not raw JSON.
4. **Be honest about gaps** — if a tool returns no data, say so (body comp often empty).

## User intent → tool mapping

| User asks… | Tools |
|------------|-------|
| What did I do today / recent workouts | `get_latest_activity`, `get_activities_range` |
| Sleep this week | `get_sleep_data` |
| Am I recovered / train hard? | `get_recovery_status`, `get_sleep_data`, `get_stress_levels` |
| HR trend / resting HR | `get_heart_rate_trends` |
| Weight / body comp | `get_body_composition` |
| Stress / overtraining | `get_stress_levels`, `get_training_insights` |
| Fitness / VO2 max | `get_vo2_max_trends` |
| Weekly summary | `get_training_insights` (+ others as needed) |

## Example prompts

See [prompts.md](prompts.md) for copy-paste examples. After setup, users can also ask naturally:

- "What did I do today?"
- "How's my sleep been this week?"
- "Am I recovered enough to train hard tomorrow?"
- "Give me a weekly training summary."

## Diagnostics

If data looks wrong or tools fail, suggest:
```bash
garmin-bud check
garmin-bud cache clear
```
