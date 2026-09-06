# Announcement drafts

Working copy for the launch. Edit freely — these are written to be *honest about
the setup cost*, because the fastest way to a bad first thread is a post that
undersells what the reader has to do.

**Three facts every version of this must carry**, because they are the top
comments otherwise:

1. You run the server. There is no hosted TrainBud and there is no account.
2. AI features are bring-your-own Anthropic key, and metered.
3. MFA on your Connect account is not supported by the underlying library.

Links: <https://www.npmjs.com/package/trainbud> ·
<https://github.com/Zsadigzade/trainbud> ·
<https://apps.garmin.com/apps/303bda81-2851-44b3-8550-a6fa5923f427>

---

## r/mcp and r/LocalLLaMA

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

MIT, Node 20+. Not affiliated with any device vendor.

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
typed on the watch.

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

## Product Hunt

**Tagline (60 char max):**
Talk to your training data — and ask from your wrist

**Alternates:**

- Your fitness data, in the AI you already use
- Ask your own training history what it means

**Description:**
TrainBud connects your fitness data to Claude, Cursor and any MCP client, and
adds a watch app so you can ask from your wrist. It runs entirely on your own
machine: no account, no hosted service, no telemetry. Findings are computed
against your own 28-day baselines, not a population average — and the app says
when it does not have enough history to compare anything yet, rather than
pretending everything is fine.

**Maker's first comment:**

I built this because my training data was something I looked at rather than
something I could ask about.

Two things I want to be upfront about, because they will decide whether this is
for you:

**You run it.** There is no hosted TrainBud and no account. `npx trainbud setup`
configures it on your machine, your credentials live in a local `.env`, and the
watch app talks to a server you expose over your own tunnel. That is a real
setup cost and I am not going to pretend otherwise.

**AI is optional and billed to you.** It runs on your own Anthropic key. The
dashboard shows tokens and cost per call, month-to-date, and an optional cap
that refuses a request rather than spending past it. A model with no published
price is recorded with its cost *unknown* rather than zero, because a call
priced at zero makes a cap that can never trip.

The part I am most pleased with is the smallest: absence is a state. An unworn
night is "unknown", not a recovery score of zero. Getting that wrong told a
well-rested user to rest because their watch had been on the charger.

Happy to answer anything.

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
you point a tunnel at it yourself. Worth knowing: a paired watch holds the
server's API key rather than a scoped per-device token — documented in the
privacy policy, and a per-device token is the next thing on my list.

**"What does the AI cost me?"**
Whatever your own provider charges. A daily insight is one short call; an Ask is
one short call. The dashboard meters both and will refuse past a cap you set.
