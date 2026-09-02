# TrainBud Connect IQ Widget

Display TrainBud recovery, sleep, activity, stress, and VO2 max on your Garmin watch.

The widget calls `GET /api/watch` on your running `trainbud serve` instance (via HTTPS tunnel). It does **not** run AI on the watch — it shows a compact summary from your local TrainBud server.

## Prerequisites

1. **TrainBud server running**
   ```bash
   trainbud serve
   ```

2. **HTTPS tunnel** (required — watches need HTTPS)
   ```bash
   cloudflared tunnel --url http://127.0.0.1:3847
   ```
   Copy the `https://*.trycloudflare.com` URL.

3. **API key** from your `.env`:
   ```env
   TRAINBUD_API_KEY=your-key-here
   ```

4. **[Connect IQ SDK](https://developer.garmin.com/connect-iq/sdk/)** installed

5. **Developer key** from [Garmin Developer Portal](https://developer.garmin.com/connect-iq/submit-an-app/)

## Configure the widget

Open **Garmin Connect Mobile** → your device → **Connect IQ** → **TrainBud** → settings:

| Setting | Value |
|---------|-------|
| **Server URL** | Your tunnel URL, e.g. `https://abc.trycloudflare.com` (no trailing slash) |

Sync the watch. On first open the widget shows a pairing code — approve it in the
dashboard to complete setup. No manual API key entry required.

Until a URL is set the widget shows a **Setup required** screen pointing at the
setup guide. That is deliberate.

> **The store build ships no default Server URL, and must not.** It carried one
> from 1.2.0 to 1.3.0 — a personal ngrok tunnel — and every store install
> skipped the setup screen and failed to pair against it. A Forerunner 55 user
> reported it on 2026-09-02; it had been broken for every user on every device
> the whole time. See `resources/settings/properties.xml`.

### Sideloading, where there is no settings screen

Sideloaded apps get no Connect IQ settings screen, so development needs a baked
URL. That is what `monkey-dev.jungle` is for — it layers `resources-dev` over
the shipped properties, and `resources-dev/settings/properties.xml` is
gitignored so the URL never reaches a commit or a store package.

```powershell
cp resources-dev\settings\properties.xml.example resources-dev\settings\properties.xml
# edit it to your own tunnel URL, then:
monkeyc -f "monkey.jungle;monkey-dev.jungle" -o bin\TrainBud-dev.prg -y developer_key.der -d fr55 -w
```

Never build the store package with that overlay.

## Build and sideload

**Quick build** (uses active SDK from Garmin Connect IQ SDK Manager):

```powershell
cd <path-to-trainbud>\ciq
.\build.ps1
# Default device: fenix847mm (Fenix 8 47mm)
```

**Manual build:**

```powershell
monkeyc -f monkey.jungle -o bin/TrainBud.prg -y developer_key.der -d fenix847mm -w
```

First run generates `developer_key.der` via OpenSSL if missing.

**Simulator:**

```powershell
monkeydo bin/TrainBud.prg fenix847mm
connectiq
```

## Using the widget

1. Add **TrainBud** to your watch's glance list or app list
2. The **glance** shows recovery and sleep without opening anything — it reads the
   last cached summary, so it renders instantly and never blocks on the network
3. Open it to fetch fresh data, then move through the cards. On a touch watch,
   tap or swipe left/right. On a button watch — fr55, fr745 and the three
   Instinct 3 variants — **UP** and **DOWN** page through them and **START**
   selects. On-screen hints name whichever applies to your device.
   - **Overview** — recovery, sleep, stress and VO2 max in a 2×2 grid
   - **Recovery** — score with colour ring (round watches) or bar, plus resting and max HR
   - **Sleep** — hours + quality score
   - **Activity** — name, duration, distance, average HR, with VO2 max and trend
   - **Stress** — average + label
   - **AI Insight** — the day's one-line tip
   - **Ask AI** — preset questions, answer paged on screen

Page dots at the bottom show your position in the carousel.

> Heart rate and VO2 max used to be cards of their own. They were folded into
> Recovery and Activity in 1.2.0 — resting HR is read alongside recovery, and VO2
> max is one number that did not justify its own swipe.

Tap, swipe, or press START/UP/DOWN on an error or setup screen to retry. If the
server is unreachable the widget shows your last cached summary with a stale
indicator.

## Connect IQ Store

See [STORE-LISTING.md](STORE-LISTING.md) for submission copy, assets, and checklist. Privacy policy: [docs/PRIVACY-POLICY.md](../docs/PRIVACY-POLICY.md).

## API endpoint

The server exposes:

```http
GET /api/watch
Authorization: Bearer YOUR_TRAINBUD_API_KEY
```

Example response:

```json
{
  "daily_overview": { "recovery": 72, "sleep_h": 7.5, "stress": 28, "vo2max": 48.5 },
  "recovery": { "score": 72, "label": "Light" },
  "sleep": { "hours": 7.5, "score": 85, "label": "Great" },
  "activity": {
    "name": "Morning Run",
    "distance_km": 5.2,
    "duration_min": 32,
    "avg_hr": 148,
    "date": "2026-06-26 07:30:00"
  },
  "stress": { "avg": 28, "label": "Medium" },
  "vo2max": { "value": 48.5, "trend": "stable" },
  "heart_rate": { "resting": 52, "max": 171 },
  "updated_at": "2026-06-26T21:00:00.000Z"
}
```

Each field is `null` if that metric is unavailable — the widget shows "No data" for that card.

## Troubleshooting

Every negative code below is a **Connect IQ constant, not an HTTP status**.
Read the sign first: `-200` is not "HTTP 200". The full list is in the SDK docs
at `doc/Toybox/Communications.html`.

| On the watch | What it means | Fix |
|--------------|---------------|-----|
| **Setup required** | No Server URL is set | Enter it in Connect IQ app settings and sync |
| **Not a TrainBud server** | Something answered and it was not us: a stopped tunnel, a captive portal, the wrong address | Check the URL shown under the message |
| **Cannot reach server** + `-104` | No phone connection | Reconnect the watch to the phone |
| **Cannot reach server** + `-1001`, URL shown as `http://` | Connect IQ requires HTTPS | Use an `https://` URL; plain HTTP is refused even on loopback |
| **Cannot reach server** + `-1001`, URL already `https://` | The certificate was refused | Use a publicly trusted certificate; self-signed is rejected, in the simulator too |
| **Server refused pairing** + `429` | Rate limited | Wait a minute and retry |
| `-200` | The request was refused **on the device** before it was sent, for an invalid header | Content-Type must be a `Communications.REQUEST_CONTENT_TYPE_*` constant; never send `Accept`; never send an empty `:headers => {}` |
| `-400` | The response body was not the JSON that was asked for | Usually an HTML error or interstitial page; check what the URL actually serves |
| "Could not reach TrainBud" | Paired, but the summary fetch failed | Ensure `trainbud serve` and the tunnel are running |
| Stale data | Serving cache | Re-open the widget; cached data shows a yellow "Updated Xm ago" banner |

## Connect IQ Store

Publishing to the Connect IQ Store requires a Garmin developer account and app review. See [STORE-LISTING.md](STORE-LISTING.md) for the full submission checklist.

See also: [docs/WEB-MCP.md](../docs/WEB-MCP.md), [README.md](../README.md).
