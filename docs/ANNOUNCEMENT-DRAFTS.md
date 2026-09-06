# Announcement drafts

Working copy for the launch. Edit freely — these are written to be *honest about
the setup cost*, because the fastest way to a bad first thread is a post that
undersells what the reader has to do.

**Three facts every version of this must carry**, because they are the top
comments otherwise:

1. You run the server. There is no hosted TrainBud and there is no account.
2. AI features are bring-your-own Anthropic key, and metered.
3. MFA on your Connect account is not supported by the underlying library.

**One naming rule.** The vendor's name is never the app name, the package name,
the repo name, the icon, or the store listing — that is what got the previous
submission rejected. It appears in launch copy only as an accurate statement of
*compatibility*, which the Connect IQ Developer Agreement §VIII.a permits now
that the app is approved, and every post carries the disclaimer line.

Links: <https://www.npmjs.com/package/trainbud> ·
<https://github.com/Zsadigzade/trainbud> ·
<https://apps.garmin.com/apps/303bda81-2851-44b3-8550-a6fa5923f427>

---

## Pre-flight — do these before the first post goes up

- [ ] **Publish 0.5.2.** The drafts below claim per-device tokens ship today.
      That is true in `main`, not on npm until the tag runs. Tag, then *check the
      run* — a tag-triggered workflow reports to no one, and that is how "not on
      npm" survived as a fact for ten weeks.
- [ ] **Tunnel up.** `trainbud doctor` in one line. Every link in every post is
      a dead product if the tunnel is down, and a reviewer cannot test a
      BYO-server app without one.
- [ ] **Record the 30s capture.** Ask in Claude Desktop → answer streams back →
      cut to the wrist. One asset, used in the X post, the r/ClaudeAI post, the
      README top, and every directory listing.
- [ ] **Submit the directories first**, so the listings exist before the traffic:
      Glama, PulseMCP, mcpservers.org, and an `awesome-mcp-servers` PR. Skip
      Smithery — it leans toward remotely-hosted servers and this one is
      local-credentials-only.
- [ ] Repo topics and npm keywords are already set. Nothing to do.

## Running order — one day, sequential, not parallel

Attention is the scarce resource, not reach. Each channel gets a real window.

| Time (UTC+4) | Channel | Note |
| --- | --- | --- |
| 15:45 | `trainbud doctor` | Last check. Tunnel, AI key, history depth |
| 16:00 | **Show HN** | 08:00 ET, the only slot that matters. Full attention, 90 min |
| 17:30 | r/mcp, r/selfhosted, r/ClaudeAI | Post, then back to the HN thread |
| 19:00 | X thread | Links whatever the HN thread became |
| 20:00 | MCP / Anthropic Discords | Async, no thread to hold |
| later week | r/Garmin | Separate post, separate framing |

---

## Show HN

> **Title:** Show HN: TrainBud – an MCP server for your Garmin data, and a watch
> app that asks Claude

I got tired of my training data being something I look at instead of something I
can ask about, so I built an MCP server for it.

`npx trainbud setup` walks you through credentials, authenticates, and writes
your Claude Desktop or Cursor config. After that you can ask "am I recovered
enough to train hard tomorrow" and get an answer computed from *your* 28-day
baselines rather than a population average.

Three decisions that shaped the whole thing:

**Findings are computed in code; the model only phrases them.** "Resting HR 4
bpm above your 28-day baseline, 3 days running" is a detector, not a generation.
I did not want a model inventing a trend, and once the numbers were computed
outside the prompt I could test them.

**The server grades, the watch draws.** Thresholds resolve server-side and the
payload carries a resolved state per metric. The watch used to hold its own copy
of the bands, which meant the wrist and the browser could disagree about the
same number while both were "working".

**Absence is a state.** An unworn night is `unknown`, not a recovery score of
zero. Getting that wrong told a well-rested user to rest because their watch had
been on the charger. Two real bugs came from that one confusion before I made it
explicit in the types.

There is also a Connect IQ watch app. The server exposes a compact JSON summary,
the watch draws it, and an Ask card sends a question to your own server, which
calls the model on your behalf — nothing is typed on the watch, and no key is
stored there beyond a token scoped to that one device.

**What you have to accept:** you run the server yourself, on your machine, with
your own Connect credentials in a local `.env`. There is no hosted version and I
am not planning one. AI features need your own Anthropic key and the dashboard
meters every call with an optional monthly cap. MFA is not supported — the
unofficial library it drives cannot do it.

MIT, Node 20+, 569 tests. Unofficial community project, not affiliated with or
endorsed by any device vendor.

---

## r/mcp

> **Title:** TrainBud — an MCP server for your own fitness data, plus a watch app
> that asks the model from your wrist

I got tired of my training data being something I look at instead of something I
can ask about, so I built an MCP server for it.

`npx trainbud setup` walks you through credentials, authenticates, and writes
your Claude Desktop or Cursor config. After that you can ask things like "am I
recovered enough to train hard tomorrow" and get an answer computed from *your*
28-day baselines rather than a population average.

Fourteen tools: activities, sleep, heart rate, recovery, body composition,
stress, VO2 max, a weekly review, and a memory layer that records goals, races
and how a session actually felt so the model has context beyond today.

The part I did not expect to build: a Connect IQ watch app. The server exposes a
compact JSON summary, the watch draws it, and an Ask card sends a question to
your own server, which calls the model on your behalf. Nothing is typed on the
watch.

Design decisions that might interest this sub:

- **The server grades, the watch draws.** Thresholds resolve server-side and the
  payload carries a resolved state per metric. The watch used to hold its own
  copy of the bands, which meant the wrist and the browser could disagree about
  the same number.
- **Findings are computed in code; the model only phrases them.** "Resting HR 4
  bpm above your 28-day baseline, 3 days running" is a detector, not a
  generation. I did not want a model inventing a trend.
- **Absence is a state.** An unworn night is `unknown`, not a recovery score of
  zero. That distinction cost me two real bugs before I made it explicit.

**What you have to accept:** you run the server yourself, on your machine, with
your own Connect credentials in a local `.env`. There is no hosted version and I
am not planning one. AI features need your own Anthropic key and the dashboard
meters every call with an optional monthly cap. MFA is not supported — the
unofficial library it drives cannot do it.

MIT, Node 20+. Unofficial community project, not affiliated with any device
vendor.

---

## r/selfhosted

> **Title:** I self-host my fitness data so I can ask an LLM about it — MCP
> server, SQLite, no account, no cloud

Same product as the r/mcp post, reframed. This sub does not care that it speaks
MCP; it cares where the data sits.

My watch data lived in someone else's app, where I could look at it and nothing
else. TrainBud pulls it onto my own machine and puts it behind an interface I
can actually ask questions.

What runs where:

- A Node server on your box, bound to `127.0.0.1` by default
- SQLite on your disk — a year of history, yours, no retention policy but yours
- Credentials in a local `.env`, sent to one place: the vendor's own login
- No account, no telemetry, no hosted anything. I am not running a backend and I
  do not want to be responsible for your health data
- Internet-reachable only if *you* point a tunnel at it, which you need only if
  you want the watch app

The AI part is optional and it is the one thing that leaves your machine: it
calls Anthropic with your own key, metered per call in a local dashboard with an
optional monthly cap that refuses a request rather than spending past it. Turn it
off and everything else still works — the findings are computed by detectors in
code, not by a model.

Honest costs: setup is real (credentials, an API key if you want AI, a tunnel if
you want the watch), and MFA on the vendor account is not supported by the
library underneath.

MIT, Node 20+. `npx trainbud setup`.

---

## r/ClaudeAI

> **Title:** Built an MCP server that lets Claude answer questions about my own
> training data — and a watch app that asks it from my wrist

Lead with the video.

`npx trainbud setup` writes your Claude Desktop config for you — no MCP JSON
editing. There is also a Claude Code plugin, which installs the skills and the
MCP server in one step:

```text
/plugin marketplace add Zsadigzade/trainbud
/plugin install trainbud@trainbud
```

Then you ask "how's my sleep been this week" or "am I recovered enough to train
hard tomorrow", and the answer is computed against your own 28-day baselines
rather than generated.

The thing I care most about: Claude is not asked to spot the trend. Detectors in
code produce "resting HR 4 bpm above your 28-day baseline, 3 days running", and
the model's job is to phrase it and answer follow-ups. That is what makes it
safe to point at health data.

Runs on your machine, your credentials, your Anthropic key, metered with an
optional cap. MIT.

**Check the sub's self-promo rule the day you post** — some weeks it is
showcase-thread-only.

---

## X / Twitter thread

**1/**
Your watch shows you today's numbers. It does not tell you what they mean.

TrainBud is an MCP server for your own fitness data — ask Claude about your
sleep, load and recovery in plain English.

`npx trainbud setup`

**2/**
It answers against *your* baselines, not a population average.

"Resting heart rate 4 bpm above your 28-day baseline, 3 days running."

That is a detector running in code. The model only phrases it. I did not want an
LLM inventing a trend.

**3/**
There is also a watch app.

The server sends a compact summary, the watch draws it, and an Ask card sends
your question to your own server — which calls the model for you. No key is ever
typed on the watch, and the token it holds is scoped to that one device.

**4/**
The design rule that killed the most bugs: the server grades, the watch draws.

Thresholds resolve in one place and the payload carries a resolved state per
metric. When the watch held its own copy of the bands, the wrist and the browser
could disagree about the same number.

**5/**
Honest about the cost: you run the server. No hosted version, no account, your
Connect credentials stay in a local `.env`. AI is bring-your-own key and metered
with an optional cap. MFA is not supported.

MIT.
<github.com/Zsadigzade/trainbud>

---

## r/Garmin — later in the week, on its own

Different audience, different post. They want the watch app; most of them will
not run a server. Lead with the hardware photo, say the cost in the first line,
and expect store installs rather than completed setups.

> **Title:** I built a watch app that tells you what stands out in your training
> — and lets you ask about it from the wrist (setup required, it needs a
> companion server you run)

**SETUP REQUIRED, up front:** this is not a standalone watch app. It talks to a
companion server you run on your own computer, with your own Connect
credentials. If that is a dealbreaker, it is a dealbreaker — better to know now
than after the install.

What it does once it is running: opens on Today with the things worth knowing,
in plain language — "resting heart rate 4 bpm above your 28-day baseline, 3 days
running", "5.6 h of sleep short of your usual 6.3 h over the last 7 nights".
Then Overview, Recovery, Sleep, Activity and Stress one swipe on, and an Ask card
that answers a question from your own history.

It says when it does *not* have enough history to compare anything, rather than
pretending everything is fine. A new watch has no baseline for two weeks and it
tells you so.

Compatible with Connect IQ devices; tested on fr55, fr70 and fenix 8. Free, MIT,
and an unofficial community project — not affiliated with, endorsed by, or
sponsored by Garmin Ltd. Garmin Connect is a trademark of Garmin Ltd.

---

## Directory listing blurb — one paragraph, reused

For Glama, PulseMCP, mcpservers.org, `awesome-mcp-servers`.

> **TrainBud** — MCP server for your Garmin Connect fitness data. Fourteen tools
> covering activities, sleep, heart rate, recovery, body composition, stress and
> VO2 max, plus a memory layer for goals and races. Findings are computed against
> your own 28-day baselines by detectors in code, not generated by the model.
> Runs locally: credentials in a local `.env`, SQLite cache on your machine, no
> account and no hosted service. Includes an optional Connect IQ watch app.
> `npx trainbud setup`. MIT, Node 20+.

---

## Answers you will need in the first hour

**"Why do I need to run a server?"**
Because there is no TrainBud backend and I do not want one. Your health data
would have to live on someone's machine, and I would rather it be yours. The
trade is a real setup cost, which is why the store listing says SETUP REQUIRED
before it says anything else.

**"Is this against Garmin's terms?"**
It drives an unofficial community library against the Connect web API using your
own credentials, the same way many open-source tools do. It is not an official
integration, I am not affiliated with any vendor, and that API can change without
notice. Use your judgement.

**"MFA?"**
Not supported. The underlying library cannot do it. This is the single most
common reason setup fails and it is called out in the README and the quickstart.

**"Is my Garmin password safe?"**
It is in a local `.env` file on your own machine and is sent only to Connect. The
server binds `127.0.0.1` by default and is only reachable from the internet if
you point a tunnel at it yourself.

**"What does a paired watch actually hold?"**
A token minted for that watch alone, stored on the server as a SHA-256 hash —
so a copy of the database is not a working credential. `trainbud devices` lists
them and `trainbud devices revoke <id>` takes one away without logging out the
dashboard, the MCP endpoint, or your other watches. Until 0.5.2 the watch held
the server's master key and revoking meant rotating it for everything; a watch
paired before then keeps working and swaps to a scoped token when you re-pair.

**"What does the AI cost me?"**
Whatever your own provider charges. A daily insight is one short call; an Ask is
one short call. The dashboard meters both and will refuse past a cap you set. A
model with no published price is recorded with its cost *unknown* rather than
zero, because a call priced at zero makes a cap that can never trip.

**"Security?"**
Every response carries CSP, `X-Content-Type-Options`, `X-Frame-Options` and
`Referrer-Policy`, including the 401s. `script-src` still allows inline, because
the dashboard is server-rendered HTML with inline handlers and a nonce policy is
a page rewrite rather than a header — that one is honest debt, not a claim.
HSTS is sent only over TLS so the loopback dashboard stays reachable.
