# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] — server 0.5.0 · watch 2.0.0

TrainBud knew a great deal about your body and nothing about you. This release
adds the half that was missing, and takes four decisions off the watch that it
was never in a position to make.

### Added — a profile, and a product that knows who it is talking to

- **`src/profile.ts`** — name, units, primary sport, weekly goal, the bands at
  which a number turns amber or red, the watch card order, and the AI's voice.
  One row of `app.db`, read by every surface. Reads salvage field by field
  (a settings row that is not JSON is wreckage, not configuration, and
  `getProfile` sits on the path of every watch fetch); writes are strict and
  name the field they refused.
- **Personal thresholds decide colour everywhere.** Resting heart rate is graded
  on the distance from *your own* median rather than on the rate — 58 bpm is
  unremarkable for one person and a warning for another.
- **Card order and visibility** are set in the dashboard and live on the watch's
  next fetch. No Connect IQ settings sync, no store update.

### Added — what the AI costs, which nothing had ever counted

- Every AI call records its tokens and its price. Month-to-date spend is a
  **calendar month**, not a rolling thirty days: a cap on a sliding window never
  resets, and the number is compared against a bill that runs in months.
- An optional monthly cap **refuses the request before the money is spent**, and
  says so on the watch instead of after a round trip. No cap is set by default,
  so nothing is ever blocked out of the box.
- **An unknown price is null, never zero.** A model this build has no rate for
  records its tokens and leaves the cost unknown, because a call priced at zero
  is a cap that can never trip. Every total carries the count of calls it could
  not price and says when it is a floor rather than a total.

### Added — the Ask menu you write yourself

Up to five questions, set in the dashboard, that lead the Ask menu on the wrist in
the order you put them — ahead of the generated ones, in every state, including the
first fortnight when the app has nothing of its own worth asking about. Whatever
slots are left still fill from what actually fired, so "Why is my resting HR up?"
keeps its place on the day it is up.

**`ai.customPrompts` had existed since the profile landed and nothing read it.** It
was in the schema, it validated, it saved — and no dashboard control wrote it and no
code path consumed it, so a question typed against that API could never have appeared
on a watch. The bounds it shipped with said as much: eight questions for a five-slot
menu, 120 characters for a line the watch draws at 32. Both now come from
`promptSuggestions.ts`, which owns the menu, and the profile refuses to store a
question that could not be shown.

### Added — a training dashboard

- Phone first, because the pairing flow already was. Findings, the week against
  last week, resting heart rate and sleep against your own median, spend, and
  every setting above.
- Drawn from local SQLite and nothing else — no Garmin round trip, so it paints
  instantly and works with an expired session. Charts are inline SVG built by
  pure functions; there is no CDN, because a script tag would tell a third party
  every time you opened your own health dashboard.
- **A missing day is a gap, not a zero.** Lines break at an absence, days are
  placed by date rather than by array position, and a chart with nothing to draw
  says so instead of rendering an empty axis that reads as "zero, every day".

### Added — local feature counters

Which of the nine cards anyone opens, and how often the Ask path runs. Counted
on a request the watch was already making rather than per swipe. On by default
because there is no endpoint to send them to; switchable off, with a delete
button, in the dashboard under Privacy.

### Changed — the watch draws state, it no longer decides it

`recoveryColor`, `sleepColor`, `stressColor` and `heartRateColor` are gone from
the Monkey C. The server grades; the watch colours. That removed three defects
rather than moving code: the Overview grid graded two of its four cells and
recovered the number by re-parsing its own formatted string (`parseNumber("6.3h")`
returns 6); `heartRateColor` painted one line holding both the resting and the
maximum heart rate while grading only the resting one; and a missing value fell
through to white, which is also what "graded and unremarkable" looks like.

### Fixed — on the wrist

- A finding that does not fit is **counted, not dropped**. The same payload
  showed two findings on a Fenix and one, silently, on a Forerunner 55.
- The recovery ring no longer strikes through the heart-rate line beneath it.
  A circle narrows as it descends; the label had been tested against that since
  1.3.2 and the line under it never was.
- Severity is a marker, not the text colour. A warning arrived as five lines of
  red on black — the least legible combination there is on a transflective
  screen in daylight.
- A big **fall** in training load is marked. Only a rise was, so a 40% collapse
  — the shape of an illness week — passed without a mark.
- Colours are chosen against the worst screen in the manifest. The Forerunner 55
  has an eight-colour palette and rounds everything to the nearest entry, which
  is why "good" is `#4CD964`: the mint the dashboard shipped with rounds to CYAN
  there.

### Fixed — verification

The Forerunner 55 could not finish the screen tour. It died partway through,
twice, reported as "keypress did not register" — which reads exactly like the
simulator being flaky, and was not: the tour allocated a second full payload
while the first was still live, and on that device it is the difference between
fitting and not. All 28 states now capture on fr55 and fenix847mm.

### Fixed — store screenshots the app actually drew

The Connect IQ listing still carried five 1.3.x captures: an Overview grid from
before all four cells were graded, and findings as coloured body text rather
than white text with a severity marker. Replacing them had already failed twice
in one day — once because the screen tour paints its state counter over the app
("9/28" above the title, in five images that reached the tree), once because the
crop was measured inwards from the simulator window instead of from the device,
so it sat off-centre and carried the watch case, and the vendor's wordmark
printed on it, into a picture meant to be the screen.

- **`build.ps1 -Screens -NoLabel`** compiles the counter out through a
  `ScreenTour.labelVisible()` annotation pair, so no keypress can bring it back.
- **`capture-sim.ps1 -Display -Device <id>`** locates the device artwork in the
  window and adds `display.location` from the SDK's own `simulator.json`,
  writing the display at native resolution — 390×390 on fr70 — with the corners
  a round screen cannot physically show blacked out. If the artwork is not
  there at 1:1 it refuses, rather than cropping something plausible.
- **`capture-store-shots.ps1`** drives the tour, refuses any build but the
  label-free one, re-checks every saved image for the counter's colour, and
  stops the run when a keypress does not land instead of naming every remaining
  file after the state before it.

`ciq/store/screenshots/store/` is now Today, Week, Recovery, Overview and Ask as
2.0.0 draws them. The five whole-watch 558x558 images that sat beside them are
gone: nothing referenced them, they were 1.3.x too, and they were pictures of a
watch rather than of a screen.

---

## [0.4.1] — server 0.4.1 · watch 1.4.0

"The AI says it has no access to my data" was reported once and fixed once, in
`bb1fae8`. This release is what an audit found behind it: **four more distinct
causes of that same sentence**, none of which the first fix touched, plus six
defects the sweep turned up alongside them. Every one was verified against this
machine's real install, whose Garmin session is genuinely gone and whose record
genuinely stops on 2026-08-21 — which turned out to be the most valuable test
fixture in the project.

### Fixed — the AI could not see the user's data, four more ways

- **The one tool that reads the store told the model the store was empty.**
  `get_findings` and `trainbud findings`, on a store holding 74 days:
  *"Still gathering data — 74 of the 14 days needed."* `coverage.ready` carries
  two refusals that need opposite answers — not enough history yet, and plenty
  of history that stops weeks ago — and `bb1fae8` taught exactly one of the four
  surfaces to tell them apart. `FindingsPayload.coverage` was also typed
  `{ days, ready }` while the value assigned to it carried four fields, so the
  renderer could not have read `throughDate` had it wanted to. One
  `describeFindingsCoverage`, read by all four surfaces.

- **Nothing on the read path had ever opened the history store.** Every
  per-metric tool read Garmin and nothing else, so an expired session meant
  `get_sleep_data` threw, all six of the watch summary's payload calls returned
  null, and an MCP client got a tool error — with 598 measurements and 2139
  archived Connect responses on disk. Tools now fall back to `raw_payload`,
  re-run through the *same* mapper the live path uses so a stored night keeps
  its stage breakdown, and to `daily_metric` behind it for days older than the
  180-day archive. **The window moves too**: with the record ending 08-21, "the
  last 7 nights" selects seven days that were never recorded, so serving the
  store changed nothing until the window could slide to where the data is — and
  say so, in capitals, so no model reads a fortnight-old week as this week.

- **A dependency printed English into the middle of the MCP protocol stream.**
  `garmin-connect` calls `console.log('login page title:', …)` on every
  re-login, and `console.log` writes to stdout, which is the JSON-RPC channel
  for `trainbud start`. Claude Desktop and Cursor — the two clients `setup`
  configures — lose the session on any re-login inside a tool call. Stdout is
  now claimed for the life of the process rather than one more `console` method
  being patched at one more call site.

- **Any CLI command killed the answer the watch was waiting for.**
  `reconcilePromptJobs` ran inside `getDb()`, so the first time *any* process
  opened `app.db` it flipped every in-flight job to *"The server stopped before
  this answer came back."* Running `trainbud doctor` while the watch waited did
  exactly that. It now runs once, from `serve`, and never touches a job younger
  than five minutes.

### Fixed — numbers the app stated and had not measured

- **"This week against last week" compared seven days against eight.**
  `series(kind, n)` spans `n + 1` days inclusive, so `WEEK_DAYS * 2` split at
  `today - 7` gave halves of 7 and 8. The TRIMP load line beside it summed two
  correct seven-day windows, so a single card disagreed with itself.

- **The sleep card called a fortnight-old night "last night".**
  `hours.slice(-7)` is the last seven *rows*, which are seven nights only if the
  watch was worn every night. Windowed by date now, like `detectors.ts` and
  `week.ts` already were; a week with nothing in it reports no debt rather than
  a debt of zero.

- **`status` reported 1590 empty days for a store covering 366 dates.** The
  count was over `ingest_day` rows, which are keyed (date, source) across six
  sources. Now 292 empty days against 74 measured — figures that add up.

### Fixed — security and data loss

- **The crash handler wrote the API key to the log the request logger had
  stopped writing.** The dashboard authenticates with `?token=`, and
  `logger.error({ error, url: req.url })` was raw. The occurrence already
  present in `.trainbud/mcp.log` has been scrubbed. **Rotate the key**: a
  credential that has sat in a world-readable file is exposed whatever the file
  says now.

- **Only `app.db` was hardened to 0600.** `history.db` — a year of sleep, heart
  rate and HRV — `cache.db` and the log file were all at the default 0644.

- **`setup` rewrote the user's Claude Desktop config keeping only our own key.**
  `readMcpConfig` returned `{ mcpServers }` and the write dropped everything
  else; a config with no `mcpServers` key at all was replaced wholesale. The
  file is now read whole and copied to `<name>.bak.json` before being touched.

- **The retry path erased the rate-limit block it had just walked into.**
  `withGarminClient` called `resetGarminClient`, which clears the persisted
  cooldown, and then forced a login into the live block — on the single path
  that block exists to guard. Splitting "forget the session" from "forget the
  limit" also lets the backoff ladder escalate, which it never could.

- **The cooldown test wrote a live five-minute Garmin block into the
  developer's own database.** Found by attempting a backfill after the suite
  passed. Tests no longer touch the real `app.db`.

### Notes

Two regression tests in this release passed against the deliberately broken
build before being rebuilt. Reverting the fix remains the only thing that
separates a regression test from a decoration.

## [0.4.0] — server 0.4.0 · watch 1.4.0 - 2026-09-03

Reported as "AI Unavailable, Error HTTP -400" on the Ask card. The AI was never
asked: the tunnel was down, ngrok answered an HTML error page, and Connect IQ
cannot parse HTML as JSON. Three surfaces had by now invented three vocabularies
for the same class of failure, and this release collapses them into one — then
adds the check that would have found it in a sentence.

### Fixed

- **A request that never reached the server was reported as a broken AI.**
  `onPromptSubmitted` set the error to `"HTTP " + responseCode` under the heading
  *AI unavailable*, so `-400` — which means the response body could not be parsed
  — blamed the one component that had not been contacted. The pairing flow
  already classified this exact code correctly and the prompt flow never called
  it. `PairFail` is now `Fail` (`ciq/source/Fail.mc`) and pairing, the summary
  fetch and the prompt all route through it.

- **A rotated API key was reported as an unreachable server.** Any summary
  failure drew "Could not reach TrainBud", including a 401 from a server that had
  answered perfectly well. A new `UNAUTHORIZED` class says *Watch not authorised
  — pair this watch again*.

- **A prompt poll that failed every time looked like one still running.**
  `onPromptStatusReceived` returned silently on any non-200, so the screen sat on
  "Asking AI..." for thirty seconds and then said "Timed out", naming nothing.
  One dropped Bluetooth response is now tolerated and a run of them is reported;
  a 401 is reported at once.

- **No AI answer this app ever produced was readable.** The result was cut into
  80-character substrings and each was handed to a single `drawText`, which does
  not wrap in Monkey C — so a page was laid out on one line, ran off both edges,
  and the cut fell mid-word. It survived every build, type check and store review
  because no Anthropic key had ever been configured on the machine it was written
  on, so the success path had never once been drawn. Answers now wrap to the
  chord width and page by line.

- **`trainbud check` caused the failure it reported.** A rate-limited Garmin
  login was retried once per tool call, so one expired session became nine logins
  into a Cloudflare 429 in about five seconds. There is now a single cooldown,
  taken from the upstream's own retry-after and honoured before any login is
  attempted; a session already in hand keeps working.

- **A test asserted against the developer's environment.** `checkAiStatus`
  cleared `ANTHROPIC_API_KEY` in a `before` hook, but `src/config.ts` calls dotenv
  at module load, so the dynamic import that followed put it straight back. Green
  for the life of the project purely because no key had ever existed on the
  machine it ran on; it failed the day one was added.

### Fixed — found by an adversarial sweep

A ten-lens audit produced 52 candidates; each went to two independent verifiers
told to refute it, and 42 survived. The ones fixed here:

- **Every daily metric was fetched for the wrong day, west of UTC.**
  garmin-connect derives the calendar day from the Date it is given by
  subtracting `getTimezoneOffset()` — a function that round-trips a
  local-midnight Date and shifts a UTC-midnight one. Every Date this codebase
  produced was UTC midnight, so at UTC-5 the library asked Garmin about the 18th
  while the answer was stored under the 19th. Sleep, resting heart rate, stress
  and weight were all off by one day, silently, and every baseline and finding
  built on them described a day the user did not live. Invisible here because
  this machine is UTC+4. The suite now passes under Los Angeles, UTC, Baku and
  Auckland.

- **Sleep debt was noise roughly half the time.** It summed one-sided shortfalls
  against the user's own median, and half of anyone's nights fall below their
  median by construction. Measured over 2000 synthetic steady sleepers with no
  deficit at all it fired on 46.7% of weeks at an hour of night-to-night
  variation. Now measured against a floor; false positives fall to 8.0% while a
  genuine 1.5 h/night deficit is still caught 93% of the time.

- **An unworn night scored as a bad night.** Recovery read
  `sleep?.sleepTimeSeconds ?? 0`, scored zero hours as 35/100, and dragged an
  otherwise excellent day under the "fatigued" line.

- **A gap in the store read as a run of days.** The recent window was the last N
  *points*, not N days.

- **The request handler could not survive a throw.** One unguarded async
  callback, so a malformed `Host` header — accepted by Node's parser, rejected by
  `new URL` — exited the process, with no credential required.

- **`trainbud setup` destroyed the Anthropic key**, and a Garmin password
  containing `#` broke setup permanently, because values were written to `.env`
  unquoted.

- **Every goal and injury was saved twice**; the dashboard bound its form twice.

- **`trainbud check` caused the rate limit it reported**, and a backfill answered
  a 429 with ~1800 more requests.

- **`app.db` held the Anthropic key at 0644**, and live pairing codes were
  written to the log.

- **The glance drew a tofu box** for the "h" in "6.3h"; **an expired pairing code
  was polled forever**; **a rotated API key was hidden** behind ageing cached
  numbers; and **the Ask card accepted presses with no AI key**.

- **The only type check CI ran never looked at a test file**, which is why four
  stale fixtures compiled.

### Added

- **`trainbud doctor`, `GET /api/selftest`, and a Connection panel on the
  dashboard.** Fetches the configured public URL from outside this machine with
  the watch's own headers and grades the answer with the watch's taxonomy. Status
  alone is not the test — both of this project's expensive network bugs were a
  200 or a 404 carrying HTML — so the body is graded and a 200 of HTML fails.

- **A Week card, and `get_week_review`.** This week against last, per metric,
  split by date rather than by position so a missing day cannot shift the
  boundary. A metric absent on either side reads as unknown rather than as a
  delta against zero.

- **A load forecast.** Where the acute:chronic ratio lands if next week repeats
  this one. The existing detector fires after the jump; this fires before it. The
  projection slides the whole 28-day window forward rather than only advancing
  the acute end.

- **Sleep debt and consistency**, against the user's own median night rather than
  eight hours, with consistency as median absolute deviation so one recovery
  sleep cannot make a metronomic sleeper look erratic. Surfaced under last
  night's hours as "Usually 7.2h · variable".

- **A race countdown.** The context store has held races since the memory layer
  landed and nothing ever read one for its date, though it changes what every
  other number means — a falling load ratio is a warning in January and the plan
  in a taper. `activeContext` excludes future dates by design, so
  `upcomingContext` was added.

- **`build.ps1 -Screens` and `scripts/capture-screens.ps1`.** Every screen the
  app can draw, with no server, photographed on any device in one command. 1.3.0
  shipped to the store having never been drawn once. Three faults it caught
  immediately: the default jungle `sourcePath` was pulling the debug driver into
  the store build; a jungle setting is assigned rather than appended, so listing
  two jungles silently un-excluded the glance; and the Forerunner 55's recovery
  card collided with its own ring.

## [watch 1.3.1] - 2026-09-02

Nobody who installed the watch app from the store could ever pair it. Reported
from a Forerunner 55 on firmware 11.03; it affected every user on every device.

### Fixed — watch

- **The store build shipped a default Server URL pointing at a developer's
  personal ngrok tunnel.** From 1.2.0 onward `properties.xml` carried
  `https://backpedal-immorally-cathouse.ngrok-free.dev` as the default, so a
  fresh install found a non-empty URL, skipped the setup screen entirely, POSTed
  `/api/pair` at a host that was usually offline, and rendered "Pairing failed"
  forever. The tunnel answers `ERR_NGROK_3200` when it is not running; the watch
  read the HTML error page as `-400` and reported a pairing failure. The default
  is now empty, which routes a fresh install to a **Setup required** screen
  naming the setup guide. Sideloading keeps a baked URL through the new
  `ciq/monkey-dev.jungle` overlay, which is gitignored and never in a store
  build.

  The same default was a privacy hazard in the other direction: while that
  tunnel was up, a stranger's watch minted a pairing code against the
  developer's own health server, one approval click away from handing out a
  bearer token to somebody else's Garmin data.

- **One "Pairing failed" screen became three, each naming what the user can
  fix.** *Cannot reach server* (nothing answered), *Not a TrainBud server*
  (something answered and it was not us — a dead tunnel, a captive portal, the
  wrong address), *Server refused pairing*. The address in use is drawn on
  screen whenever the address is the suspect, and `-104`, `-1001` and `429` get
  their own one-line hints. `-1001` distinguishes a plain `http://` URL from an
  `https://` one whose certificate was refused: the same code, two different
  problems, and telling a self-hosted user to "use https" when they already do
  is a dead end.

- **Round screens were detected by measuring pixels rather than asking the
  device.** `isRoundScreen()` was `width == height && width >= 240`, so the
  Forerunner 55 — round, 208×208 — was treated as rectangular and drew the
  recovery bar instead of the ring. Now `System.getDeviceSettings().screenShape`.

- **Text wrapped to a fixed character count, which a circle does not honour.**
  A line near the top of a round screen has far less room than one through the
  middle; "Cannot reach server" rendered as "annot reach serve". Wrapping is now
  measured in pixels against the chord width available at that height.

- **The five button-only products could not navigate.** `BehaviorDelegate` maps
  UP and DOWN to `onNextPage`/`onPreviousPage` and neither was implemented, so
  on fr55, fr745 and the three Instinct 3 variants the carousel only moved
  forwards one START press at a time and the Ask menu could not be scrolled at
  all. Every on-screen hint also said "tap"; hints are now chosen from
  `System.getDeviceSettings().isTouchScreen`.

- **Grey was invisible on the Forerunner 55.** Its palette holds eight colours
  and none of them is grey, so `COLOR_DK_GRAY` snapped to black on a black
  background: inactive page dots, faded Ask items, card footnotes and the ring
  track all vanished. Secondary elements use a colour that survives the palette,
  and inactive dots are outlined rather than filled, so the hierarchy is carried
  by shape.

- **Pairing telemetry is debug-only.** The pairing screen drew `9/8 200` in the
  corner of a store build — unexplainable to a user, and the difference between
  a poll that never ran and one discarded on the device to anyone debugging.

- **The AI disclaimer is now on screen.** The string existed from 1.2.0 and was
  never drawn anywhere, so the app made training and recovery statements on a
  health device with nothing to qualify them. It renders on the last page of an
  answer.

### Fixed — watch, found by drawing it

Everything below was found by running 1.3.1 in the simulator on a Forerunner 55
and a fenix 8 47mm and looking at every card. None of it was visible from the
source, the type checker or a green build, and none of these screens had ever
been drawn on any watch: 1.3.0 shipped its `.iq` without a single render.

- **The Today card printed its first finding through its own title,** and cut a
  character off each end of it: "Resting HR 4 bpm above" drew as "esting HR 4 bpm
  above". It centred the text block on the screen rather than in the space below
  the heading, and wrapped to a fixed 24 characters. This is card 0 — the first
  thing a paired user sees.

- **The Sleep card drew an empty yellow box next to "6.3".** The FONT_NUMBER_*
  faces contain digits and separators and no letters, so the "h" rendered as a
  missing-glyph box — and a box has a width, so the "does this fit" check passed
  and the value never stepped down to a font that has letters. The Recovery
  card's "No data" had the same fault waiting.

- **The Ask AI card printed the selected prompt underneath its own hint:**
  "Why is my re[STA]sting HR up?". The hint was right-justified against the
  screen edge at the vertical centre, which on a circle is exactly where the
  widest line already is.

- **The carousel dead-ended on the Ask card.** Going back from the first prompt
  left the card, but going forward from the last one wrapped around, so the six
  metric cards after it could only be reached by paging *backwards* from Today.
  It now leaves at both ends, on buttons and on swipe.

- **The AI Insight card overlapped its own lines on large screens.** The line
  step was a hardcoded 20 px, which is about right for the 208 px Forerunner 55
  and much too small for a 454 px fenix. Every hardcoded line step is now
  derived from the font.

- **The Recovery card printed "Ready" through the bottom of the score,** for the
  same reason: the label sat at a fixed offset from the centre while the score
  is drawn in a font whose height nearly doubles between those two devices. The
  label and the heart rate line are now stacked off the score's measured height.

- **"Resting 48  Max 178" lost its last digits** at the bottom of a 208 px round
  screen. It now shortens the *label* before the number: "Rest 48  Max 178".

- Activity card: the workout name was cut to 14 characters before being drawn,
  which threw away room a smaller font would have used. `drawFittedValue`
  already measures and steps down; the character cut is gone. This was the last
  item open on that card.

### Fixed — "AI unavailable" meant four different things

Reported as "it still shows AI Unavailable". The cause on this install was that
**no Anthropic key had ever been configured**: the settings table was empty,
`.env` had no `ANTHROPIC_API_KEY`, and the only two prompt jobs ever created, on
2026-08-17 and 2026-08-19, both failed with
`ANTHROPIC_API_KEY not configured`. AI is bring-your-own-key and genuinely could
not run. The defect is that the watch could not say so.

- **`/api/watch` now carries `ai_configured`.** `ai_insight: null` meant three
  different things — no key, a failed call, or today's insight not generated
  yet — and the watch drew one screen for all of them. The Ask card now shows
  **"AI not set up / Add an API key in the dashboard"** instead of offering five
  questions that cannot succeed, and the AI Insight card no longer tells a user
  with no key that there is "No insight today", which is a claim about today. A
  summary from an older server carries no such field; missing is read as
  configured, so nothing is asserted on no evidence.

- **The watch threw away the reason a prompt failed.** `GET /api/prompt/<id>`
  returns the server's error string, and `onPromptStatusReceived` read only
  `status` — so a missing API key and a provider outage rendered identically.
  The reason is now drawn under the message, along with a timeout and the HTTP
  code from a failed submit.

- **`trainbud check` reported AI status from the environment only.** It read
  `appConfig.anthropicApiKey` instead of `isAiConfigured()`, so a key saved
  through the dashboard — the route the setup guide tells users to take — was
  reported as absent forever. `resolveAnthropicKey()` exists for exactly this
  and this call site never used it.

### Fixed — dependencies

- `qs` 6.15.3 → 6.16.0 and `fast-uri` 3.1.5 → 3.1.7, clearing one high and one
  moderate advisory. `npm audit` is clean.

### Removed

- Dead resources and code: `drawHint()` and the `TapHint` string it drew
  (replaced by page dots in 1.2.0), plus the unused `AskHint`, `PairingPolling`
  and `CardHeartRate` strings.

## [0.3.1] - 2026-08-19

Watch pairing works. It never had, on any build, and the cause was the last one
still open: a status poll that never reached the server.

### Fixed — watch

- **Pairing completes end to end.** ngrok's free tier answers any GET carrying a
  browser-ish User-Agent with an HTML interstitial under a 200. Connect IQ sends
  `Mozilla/5.0` and will not let an app override it, so every status poll was
  answered by the tunnel, never reached the server, and failed on the watch as
  `-400 INVALID_HTTP_BODY_IN_NETWORK_RESPONSE`. POSTs are not intercepted, which
  is why `/api/pair` always worked and the poll never did. Verified in the
  simulator against the live tunnel: code issued, approved in the dashboard,
  credentials saved, summary fetched.
- Recovery ring drew the inverse of the score: the end angle is measured
  clockwise but the arc was drawn counter-clockwise, so 91 rendered as the
  missing 9%.
- Recovery ring overlapped the card title.
- Fractional values drew with six decimal places (`6.300000h`), on both the
  widget and the glance.
- The four-cell overview grid used "No data" as its placeholder, which drew over
  the neighbouring cells and their labels; it now uses a dash.
- Activity card: subtitle and footnote collided, and a strength workout listed
  "0 km" as though zero were a measurement.

### Fixed — server

- **Recovery score was NaN on every default call** and reached the watch as
  `null`: normalizeWeights spread an object of explicit `undefined` weights over
  its defaults, and `NaN <= 0` is false so the guard missed it.
- **Stress and VO2 max were fetched from URLs Connect answers 404 for.** Both
  take the date as a path segment; VO2 max is `maxmet/latest`, not
  `maxmet/daily`. The stress mapper also read fields the response does not
  contain (`overallStressLevel` rather than `avgStressLevel`), and Connect's
  negative "not measured" sentinels were averaged in as real readings.
- Pair codes came from `Math.random()`. `/api/pair` is unauthenticated by
  design, so an attacker could mint codes, recover the PRNG state, predict the
  code the watch was showing and collect the API key on approval. Now
  `crypto.randomInt`.
- Rate limiting only ever ran on `/mcp`, leaving the unauthenticated pair
  endpoints open to a walk through the six-digit code space; and buckets were
  keyed on the socket address, which behind a tunnel is one bucket for every
  client. Limits now cover every route, with a tighter budget for pairing, keyed
  on the forwarded address.
- API key compared in constant time.
- `.env`, `session.json` and the MCP client config were written world-readable
  (0644) and are now 0600.
- A single failed Garmin login was memoised and poisoned every later call until
  the process restarted.
- All four npm audit advisories cleared.

### Added

- Real Connect IQ Store screenshots, captured from a paired app in the
  simulator (`ciq/store/screenshots/`). The previous set was drawn in PowerShell
  and removed in 1.2.0.
- Tests: pair code randomness, pair rate limiting, secret file permissions,
  client auth lifecycle, the real Connect stress payload, recovery weights.
  91 tests, up from 73.

## [0.2.0] - 2026-06-26

### Fixed

- **Critical:** Logger no longer writes to stdout — pino-pretty uses stderr; file logging starts only when server starts
- **Critical:** Credentials validated at server startup, not on first tool call
- N+1 Garmin API calls batched with concurrency limit (`mapInBatches`, max 6 parallel)
- Body composition fetches parallelized instead of sequential
- Activities range queries use shared paginated pool cache (up to 500 activities) with truncation warning
- Cache keys unified via `buildToolCacheKey()` with stable sorted-param hashing
- Recovery tool uses yesterday's sleep data with fallback to prior nights
- Activity date filtering uses consistent Luxon parsing
- Session path resolved from single `getSessionPath()` in config
- Version read from `package.json` instead of hardcoded strings
- `GarminApiError` is now a proper class; auth retry uses `await`
- Tool errors sanitized before returning to MCP clients
- SQLite cache closed on SIGTERM/SIGINT/exit

### Added

- `src/version.ts`, `src/utils/batch.ts`, `src/garmin/garminApiTypes.ts`, `src/tools/types.ts`
- `filterActivitiesByRange()`, `sanitizeErrorMessage()`, `getYesterday()` helpers
- `configureLogger()` for lazy log file initialization
- `.nvmrc` (Node 20)
- `.github/workflows/publish.yml` for npm + GitHub Releases on version tags
- Project knowledge base moved to Obsidian vault (`05-Projects/trainbud/`); see `docs/VAULT.md`
- 11 new tests (32 total): cache key stability, date filtering, recovery scoring, error sanitization

### Changed

- **Rebranded** from garmin-mcp to **TrainBud** (package `trainbud`, CLI `trainbud`)
- README rewritten as product page with disclaimer, badges, and security section
- Added CONTRIBUTING.md; updated vault docs and examples
- Removed imports from internal `garmin-connect/dist/` paths
- Tool registry uses shared `ToolDefinition` interface without unsafe casts
- `runCacheClear` is synchronous

## [0.1.0] - 2026-06-26

### Added

- Initial MCP server exposing 6 Garmin Connect tools
- Email/password authentication with session persistence (`.trainbud/session.json`)
- SQLite caching layer with configurable TTL per resource type
- CLI commands: `start`, `auth`, `cache clear`, `status`
- Unit and integration tests using Node test runner
- README, QUICKSTART, and example prompts

### Notes

- Uses unofficial `garmin-connect` npm package (Windows/macOS/Linux compatible)
- MFA is not yet supported by the underlying library
