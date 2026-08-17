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

1.2.0

## Short description

Your training and recovery data on your wrist, with optional AI answers — recovery, sleep, activity, stress, VO2 max.

## Full description

TrainBud puts your training and recovery numbers on your watch face, and lets you ask an AI assistant about them without reaching for your phone.

A glance shows your recovery score and last night's sleep without opening anything.
Open it for the full set, then swipe or tap through seven cards:
• Overview — recovery, sleep, stress and VO2 max in one grid
• Recovery — score with a colour-coded ring, plus resting and maximum heart rate
• Sleep — hours and quality score
• Activity — latest workout with duration, distance, average heart rate and VO2 max
• Stress — daily average
• AI Insight — a daily one-line tip generated from your own numbers
• Ask AI — pick a preset question and read the answer on your watch

Values are colour-coded so status is readable at a glance. If the server is briefly
unreachable, the widget shows your last cached summary with an "updated X ago" marker.

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

## Required assets

| Asset | Path | Size | State |
|-------|------|------|-------|
| Launcher icons | `ciq/resources-launcher-<size>/drawables/` | 35–70, exact per device | generated |
| Store icon | `ciq/store/store_icon.png` | 130×130 | generated |
| Cover | `ciq/store/cover_500.png` | 500×500 | generated |
| Screenshots | `ciq/store/screenshots/` | 1–3 per device family | **MISSING — must be captured** |

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
> To produce real ones:
> ```powershell
> .\scripts\start-watch-stack.ps1            # server + HTTPS tunnel
> cd ciq; .\build.ps1 -Device fenix847mm
> connectiq                                  # simulator
> monkeydo bin\TrainBud.prg fenix847mm
> # pair the simulated watch via the dashboard, then File > Save Screenshot per card
> ```
> Capture at least: glance, Overview, Recovery, and Ask AI with a real answer.

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
