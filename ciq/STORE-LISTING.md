# TrainBud — Connect IQ Store Listing

Submission copy for the [Connect IQ developer portal](https://developer.garmin.com/connect-iq/submit-an-app/).

> **Naming rule — do not undo this.** A previous submission was rejected because the
> app was called *GarminBud*. Per the Connect IQ Developer Agreement §VIII.a, a
> developer "shall not include any marketing of Garmin's name, logo or other
> trademarks in your Application or in any other materials without Garmin's prior
> written consent," and §II.a.2 requires a branded username to be changed unless
> authorised. The word **Garmin does not appear in the app name, the listing copy,
> the on-watch strings, the icon, or the screenshots**. The narrow exception in
> §VIII.a — accurate statements of *compatibility* — only applies **after** an app is
> approved, so it is deliberately not used here. Once approved, compatibility
> wording may be added to the description.

## App name

TrainBud

## Category

Health & Fitness

## Version

2.0.0

## Short description

Sees what stands out in your training history — resting heart rate, sleep debt, load — and lets you ask about it from your wrist.

## Full description

Your watch already shows you today's numbers. TrainBud's companion server keeps a year
of them, and tells you what actually stands out — measured against your own baseline,
not a population average.

TrainBud opens on Today: the things worth knowing, in plain language.
• "Resting heart rate 4 bpm above your 28-day baseline, 3 days running"
• "5.6 h of sleep short of your usual 6.3 h over the last 7 nights"
• "This week's training load is 1.6x your four-week average"

Findings describe what was measured and what it means for training. They are never a
diagnosis, and the app says when it does not yet have enough history to compare
anything — a new watch has no baseline for the first two weeks, and TrainBud tells you
that rather than pretending everything is fine.

The Ask card offers questions drawn from those same findings, so instead of the same
five generic prompts every day you get "Why is my resting HR up?" on the day it is.

The numbers are all still there, one swipe on:
• Overview — recovery, sleep, stress and VO2 max in one grid
• Recovery — score with a colour-coded ring, plus resting and maximum heart rate
• Sleep — hours and quality score
• Activity — latest workout with duration, distance, average heart rate and VO2 max
• Stress — daily average
• AI Insight — a daily one-line tip built from what stood out

The glance shows the most important finding when there is one, and your recovery and
sleep when there is not. Values are colour-coded so status is readable without opening
anything. If the server is briefly unreachable, the widget shows your last cached
summary with an "updated X ago" marker.

SETUP REQUIRED — THIS APP NEEDS YOUR OWN SERVER
TrainBud is the watch front end for a free, open-source companion server that you run
yourself. It does not work standalone.

1. Install the `trainbud` companion server on your PC or Mac (Node.js 20+)
2. Run: `trainbud serve`
3. Expose it over HTTPS with a tunnel (Cloudflare Tunnel or ngrok both work)
4. In the Connect IQ app settings for TrainBud, enter that HTTPS URL
5. Open the dashboard link the server prints, and approve the six-digit code shown on
   your watch — this pairs the watch, so no API key is ever typed on the device

AI features are optional and off by default. They require your own Anthropic API key,
entered once in the companion dashboard. No AI runs on the watch: your question is sent
to your own server, which calls the AI provider on your behalf and returns the text.

HEALTH DISCLAIMER
TrainBud is for general wellness and training information only. It is not a medical
device, it does not diagnose, treat or prevent any condition, and its output — including
AI-generated text — is not medical advice. Consult a qualified professional before
making decisions about your health or training load.

TrainBud is an independent open-source project, not affiliated with, endorsed by or
sponsored by any device or platform vendor.

Setup guide and source: https://github.com/Zsadigzade/trainbud

## Privacy policy URL

https://github.com/Zsadigzade/trainbud/blob/main/docs/PRIVACY-POLICY.md

> Verify this resolves **before** submitting. The previous listing pointed at
> `Zsadigzade/Garmin-Bud`, which no longer matches the repository name.

## Screenshots

`ciq/store/screenshots/store/*.png` — five 390×390 captures of the fr70 display, in
listing order: **Today, Week, Recovery, Overview, Ask**. Today, Week and Recovery lead
because they are the three screens Garmin Connect cannot draw.

Regenerate them with two commands:

```powershell
.\ciq\build.ps1 -Device fr70 -Screens -NoLabel
.\scripts\capture-store-shots.ps1 -Device fr70
```

`-NoLabel` is not optional, and `capture-store-shots.ps1` refuses to run against any
other build. Three things have gone wrong with these assets, and each is now closed by
construction rather than by remembering:

- **Drawn, not captured.** Before 1.2.0 the set came from
  `generate-store-screenshots.ps1`, which redraws the screens in PowerShell and never
  runs the app. It now writes to `ciq/store/mockups/` and refuses to run without
  `-IUnderstandTheseAreMockups`.
- **The tour's state counter.** The screen-tour build paints "9/28" over the app's own
  pixels, and on 2026-09-04 five crops of a tour capture reached the tree with it above
  the title. `-NoLabel` compiles the counter out (`ScreenTour.labelVisible()`), so it
  cannot return through a keypress that failed to land, and the capture script re-checks
  every saved image for the counter's colour anyway.
- **A guessed crop.** The same attempt cut a square out of the middle of the simulator
  window, which is off-centre and carries the watch case — including the vendor
  wordmark printed on the bezel — into an image meant to be the screen. The crop is
  now taken from the geometry the SDK publishes: `capture-sim.ps1 -Display` locates the
  device artwork in the window, adds `display.location` from the device's
  `simulator.json`, and blacks out the corners a round display does not physically have.
  If the artwork is not found at 1:1 it refuses instead of cropping something plausible.

The numbers in these captures are the tour's sample data, not one person's live account:
the rendering is the shipping code, the values are representative. Reaching Week's spike
and the Ask card's finding-derived prompts from live data would need a year of history
to land on the right day.

## Required assets

| Asset | Path | Size | State |
|-------|------|------|-------|
| Launcher icons | `ciq/resources-launcher-<size>/drawables/` | 35–70, exact per device | generated |
| Store icon | `ciq/store/store_icon.png` | 130×130 | generated |
| Cover | `ciq/store/cover_500.png` | 500×500 | generated |
| Screenshots | `ciq/store/screenshots/store/` | 390×390, under 150 KB each | captured 2026-09-04 from the fr70 simulator, screen only: today, week, recovery, overview, ask |

Icons come from `scripts/generate-icons.ps1`; re-run it after changing the product
list and it rewrites `monkey.jungle` to match. The previous set was a large letter
**G** on teal, which reads as a vendor monogram — do not restore those files.

> **Screenshots must be captured from the simulator, not drawn.**
> `ciq/store/screenshots/` was previously filled by `scripts/generate-store-screenshots.ps1`,
> which does not run the app — it redraws imitations of the screens in PowerShell. Those
> images were removed in 1.2.0 because publishing drawings as screenshots misrepresents
> the app, and they had drifted from the real UI besides. That script now writes to
> `ciq/store/mockups/` and refuses to run without an explicit flag.
>
> To produce real ones, see **Screenshots** above:
> ```powershell
> .\ciq\build.ps1 -Device fr70 -Screens -NoLabel
> .\scripts\capture-store-shots.ps1 -Device fr70
> ```

## What changed in 2.0.0

- **Your thresholds, not ours.** The bands where a number turns amber or red are set in
  the companion dashboard, and the watch follows them. Resting heart rate is graded on
  the distance from your own median rather than on the rate itself — 58 bpm means
  something different for different people.
- **Your carousel.** Hide cards you never open and put the rest in the order you want,
  from the dashboard. It applies on the watch's next sync; there is nothing to change in
  Connect IQ settings.
- **A spending cap for the AI, if you want one.** The app runs on your own AI provider
  key, so every question costs you money and nothing had been counting. The dashboard now
  shows what has been spent this month, and an optional cap refuses further questions on
  the watch instead of quietly spending past it. No cap is set by default.
- **Findings are readable.** A warning used to be drawn as several lines of red text; the
  severity is now a coloured marker and the sentence stays white. A finding that does not
  fit on a smaller screen is counted rather than silently dropped.
- **Fixed: the recovery ring was drawn through the resting-heart-rate line** on smaller
  round screens.
- **Fixed: the overview grid coloured only two of its four values**, and derived that
  colour by re-reading its own formatted text, so 6.3 hours of sleep was graded as 6.

## What changed in 1.3.0

- **Today card, now the first screen.** Findings computed on the companion server
  against the user's own 28-day baselines: resting heart rate elevation, sleep debt,
  overnight HRV trend breaks, and acute-to-chronic training load. The metric cards are
  unchanged and moved one position later.
- **Ask prompts are generated per day** from those findings, replacing five fixed
  strings. The built-in five remain as the fallback when the server sends none.
- **Glance carries the top finding** when there is one.
- **Cold start is explicit.** Under two weeks of history, the app says how many days it
  has rather than reporting that nothing stands out.
- **Fixed: long activity names ran off both edges of the screen.** The value was drawn
  in a fixed large font and trimmed by character count; it now measures the text and
  steps the font down until it fits.

## Review notes for Garmin

- **Reviewer test server.** A live instance is available for the review period —
  URL and pre-approved pairing details are supplied in the submission form's private
  notes field. The widget shows a pairing screen until a server is configured; this is
  expected first-run behaviour, not a fault.
- The widget only contacts the HTTPS endpoint the user enters in settings. No other
  network destination is hard-coded.
- No account credentials are entered or stored on the watch. Pairing is a six-digit
  code approved in the companion dashboard; the watch stores only the resulting token.
- AI features are optional, user-funded (the user supplies their own provider API key
  in the companion dashboard), and disabled unless that key is set.
- AI output carries an on-watch wellness disclaimer (`AiDisclaimer` string) and a
  matching disclaimer in this listing. The app makes no diagnostic or medical claims.
- Only the `Communications` permission is requested.
- The companion server is open source (MIT) and self-hosted by the user.

## Developer account checklist

1. Developer account at https://developer.garmin.com, agreement signed
2. **Two IDs exist — do not confuse them.**
   - `e9204b53-2eea-4851-9071-8ce7e6839589` is the **manifest** UUID in `manifest.xml`,
     compiled into every binary. Leave it alone; changing it orphans the store entry.
   - `303bda81-2851-44b3-8550-a6fa5923f427` is the **store listing** created when
     TrainBud 1.2.0 was submitted and approved on 2026-08-17:
     <https://apps.garmin.com/en-US/apps/303bda81-2851-44b3-8550-a6fa5923f427>

   An earlier draft of this file said to rename the existing listing in place and never
   register a new ID. That turned out to be wrong: the upload produced a **new** store
   entry with its own ID while the binary kept the old manifest UUID. If a listing under
   the old GarminBud name still exists in the developer dashboard, unpublish it — two
   listings for one app confuses users and invites a takedown.
3. Build the store package. `-d all` is **not** a valid device id in SDK 9.x — the
   export build (`-e`) is what compiles every product in the manifest:

```powershell
cd ciq
.\build.ps1 -Device fr70                        # single-device smoke test
monkeyc -f monkey.jungle -o bin/TrainBud.iq -y developer_key.der -e -r -w
```

   The export is equivalent to **Monkey C: Export Project** in VS Code. A clean run
   ends with `59 OUT OF 59 DEVICES BUILT` / `BUILD SUCCESSFUL`; the remaining
   launcher-icon warnings are the compiler downscaling one source icon per device
   and are not defects.

4. Upload `bin/TrainBud.iq`, icons, screenshots and this copy
5. Paste the reviewer test-server details into the private review notes

## Supported devices

See `ciq/manifest.xml` — 38 products. Covers Forerunner (70, 570, 55, 265s, 745, 955,
965, 970), fenix 7/8/E, epix 2 and Pro, Venu 2/3, vivoactive 5/6, MARQ 2 and Instinct 3.

> Forerunner 645 and 645 Music were removed in 1.2.0. They cannot meet the manifest's
> `minSdkVersion` of 3.2.0, so a release build including them had never succeeded, and
> they predate glance support. Re-adding them would break the export build.

## Setup summary for users

1. Install and configure `trainbud` on a computer
2. Run `trainbud serve` (or `.\scripts\start-watch-stack.ps1` to start the tunnel too)
3. Start an HTTPS tunnel to port 3847
4. Connect IQ app → TrainBud settings → **Server URL:** your HTTPS URL
5. Open the dashboard URL the server prints, approve the code shown on the watch
6. Optionally add an AI provider API key in the dashboard
7. Sync the watch and add TrainBud to your widget loop

See also: [ciq/README.md](README.md), [docs/WEB-MCP.md](../docs/WEB-MCP.md)
