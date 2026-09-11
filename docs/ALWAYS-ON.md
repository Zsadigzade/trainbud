# Always-on TrainBud

Running `trainbud serve` in a terminal works until the terminal closes. This
guide replaces that with a stack that starts by itself, survives a reboot, and
puts itself back when half of it falls over.

You need this if you use the **Connect IQ watch widget** or a **remote MCP
connector** (claude.ai, ChatGPT). You do not need it for a desktop MCP client
like Claude Desktop or Cursor — those launch `trainbud start` themselves over
stdio and there is nothing to keep running.

## The failure this prevents

The watch reports `AI Unavailable, Error HTTP -400`. You check the server: fine.
You check the AI key: fine. You open the tunnel URL in a browser: a page loads.
Everything is fine and nothing works.

What happened is that the server died and the tunnel did not. A tunnel with
nothing behind it answers **its own error page, with HTTP 200**. A browser
renders that page and you conclude the link is alive. Connect IQ asks for JSON,
gets HTML, and reports a parse failure as `-400`.

So two rules run through everything below:

> **A tunnel that answers is not a server that answers.**
>
> **Check it from outside, the way the watch would** — `trainbud doctor` does
> exactly this, and it is the only check that has ever been right.

## 1. Get a stable public hostname

A **quick tunnel** (`cloudflared tunnel --url ...`, plain `ngrok http ...`) hands
out a **new random URL every time it restarts**. For always-on that is useless:
every reboot would mean re-entering the address in the Garmin Connect app and
re-pointing every MCP connector. Get a stable name first.

### Option A — Cloudflare named tunnel (recommended)

Free, no session limits, no interstitial page, and a hostname you own. It needs
a domain on Cloudflare; if you do not have one, Cloudflare Registrar sells at
wholesale (roughly $10/yr for a `.com`).

```bash
winget install --id Cloudflare.cloudflared     # or: brew install cloudflared

cloudflared tunnel login                       # opens a browser, pick your domain
cloudflared tunnel create trainbud
cloudflared tunnel route dns trainbud trainbud.example.com
```

Point the tunnel at your local server. Create `config.yml` next to the
credentials file `cloudflared tunnel create` just wrote
(`%USERPROFILE%\.cloudflared\` on Windows, `~/.cloudflared/` elsewhere):

```yaml
tunnel: trainbud
credentials-file: C:\Users\YOU\.cloudflared\<TUNNEL-ID>.json

ingress:
  - hostname: trainbud.example.com
    service: http://127.0.0.1:3847
  - service: http_status:404
```

> The catch-all `http_status:404` at the end is required — cloudflared refuses
> to start without a final rule that has no hostname.

Test it in the foreground once, before making it a service:

```bash
cloudflared tunnel run trainbud
```

Then install it as a service so it starts with the machine. **From an elevated
prompt**, using the token from the Cloudflare Zero Trust dashboard
(Networks → Tunnels → your tunnel → Configure):

```powershell
cloudflared service install <YOUR_TUNNEL_TOKEN>
```

### Option B — ngrok static domain

Free, and there is nothing to buy. Claim one at
<https://dashboard.ngrok.com/domains>, then:

```powershell
ngrok config add-authtoken <YOUR_TOKEN>
ngrok service install --config %USERPROFILE%\AppData\Local\ngrok\ngrok.yml
```

with a `ngrok.yml` holding:

```yaml
version: 3
agent:
  authtoken: <YOUR_TOKEN>
endpoints:
  - name: trainbud
    url: https://your-domain.ngrok-free.app
    upstream:
      url: 3847
```

> ngrok's free tier answers unknown browsers with an HTML interstitial. Connect
> IQ sends `Mozilla/5.0` and cannot override it, so the watch used to get that
> page instead of JSON. The watch app sends `ngrok-skip-browser-warning` on
> every request (`ciq/source/TrainBudApp.mc`), which is why it works — but it is
> one more thing that can change under you, and it is the main reason Option A
> is recommended.

## 2. Install the server as a scheduled task (Windows)

From the repository root:

```powershell
npm install; npm run build
.\scripts\install-always-on.ps1 -Hostname trainbud.example.com
```

That registers two Scheduled Tasks:

| Task | What it does |
|---|---|
| **TrainBud Server** | Runs `trainbud serve` at logon. Restarts up to 5 times on failure, one minute apart. No execution time limit — the default is three days, after which Windows would kill a perfectly healthy server. |
| **TrainBud Watchdog** | Every 5 minutes, checks the server locally **and** the tunnel from outside. Restarts whichever half is down. |

It also writes the public URL to `.trainbud/watch-setup.json`, which is where
the server looks for it.

**What it deliberately does not do:** run before you log in. That needs your
Windows password stored in Task Scheduler, and this script will not ask for one.
The promise is *"up whenever you are logged in"*, not *"up 24/7"* — if the
machine is a laptop that is switched off at night, the watch is offline at night
and no scheduling trick changes that. For genuine 24/7 see
[Section 5](#5-genuinely-24-7-run-it-somewhere-that-never-sleeps).

Undo it all with:

```powershell
.\scripts\install-always-on.ps1 -Uninstall
```

## 3. Verify — and what counts as proof

Three checks, weakest to strongest:

```powershell
.\scripts\watchdog.ps1 -WhatIfOnly   # both halves, right now, changing nothing
trainbud doctor                      # what the WATCH would see, from outside
```

Then **reboot, log in, wait two minutes, and run `trainbud doctor` again.** That
last one is the only check that proves the thing this document is about. A green
`doctor` in the session that started the server proves nothing at all: the
original bug was always invisible until the session ended.

`trainbud doctor` should read 4/4. If the public line is red while the local one
is green, the tunnel is the problem and the watchdog will restart it within five
minutes; `.trainbud/logs/watchdog.log` records every decision it makes.

## 4. Other platforms

### Linux — systemd

```ini
# /etc/systemd/system/trainbud.service
[Unit]
Description=TrainBud HTTP server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=YOU
WorkingDirectory=/home/YOU/trainbud
ExecStart=/usr/bin/node dist/index.js serve
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now trainbud
sudo systemctl enable --now cloudflared   # installed by `cloudflared service install`
```

systemd's `Restart=always` covers what the watchdog task covers on Windows for
the *server*. It does not cover the tunnel-serving-HTML case, because from
systemd's point of view nothing has failed. Keep checking with `trainbud doctor`.

### macOS — launchd

`~/Library/LaunchAgents/com.trainbud.server.plist`, with `RunAtLoad` and
`KeepAlive` both true, `ProgramArguments` of
`/usr/local/bin/node dist/index.js serve`, and `WorkingDirectory` set to the
repository. Load it with `launchctl load -w ~/Library/LaunchAgents/com.trainbud.server.plist`.

### Docker

The published image runs the stdio server by default, so override the command:

```yaml
# compose.yml
services:
  trainbud:
    image: ghcr.io/zsadigzade/trainbud:latest
    command: ["node", "dist/index.js", "serve"]
    restart: unless-stopped
    ports: ["3847:3847"]
    environment:
      TRAINBUD_HOST: 0.0.0.0          # required: 127.0.0.1 is unreachable from outside the container
      TRAINBUD_PUBLIC_URL: https://trainbud.example.com
    env_file: .env
    volumes:
      - ./.trainbud:/app/.trainbud    # session tokens, history, app.db

  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate run --token ${CF_TUNNEL_TOKEN}
    restart: unless-stopped
    depends_on: [trainbud]
```

Point the tunnel's ingress at `http://trainbud:3847`, not `127.0.0.1` — inside
compose, localhost is the cloudflared container itself.

## 5. Genuinely 24/7: run it somewhere that never sleeps

A laptop cannot be always-on. If you want the watch to work at 06:00 before the
machine is awake, the server has to live somewhere else — a small VPS, a
Raspberry Pi, or any host that stays powered.

The compose file above is the whole deployment. Two things to know before you
commit to it:

- **Your Garmin credentials and your health database move to that host.** This
  is a real change to TrainBud's local-first posture. It is your data and your
  call, but make it deliberately, and give the box a firewall and full-disk
  encryption if you can.
- **Garmin's login often challenges datacenter IP ranges.** A sign-in that
  works from home can hit an MFA or Cloudflare challenge from a cloud host.
  Test `trainbud auth` on the box **before** moving anything else. A Raspberry
  Pi on your home connection avoids this entirely, and costs no monthly fee.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `doctor` was green, now it is red, nothing changed | The session that started the stack was closed, and jobs die with their session | This is what `install-always-on.ps1` ends. Before it existed, `start-watch-stack.ps1` used `Start-Job` |
| Tunnel URL loads in a browser, watch says `-400` | Tunnel up, server down; you are reading the tunnel's own error page | `trainbud doctor`, never a browser. The watchdog catches this within 5 minutes |
| `Setup required` on a fresh watch install | The store build ships an empty `ServerUrl` on purpose | Enter the hostname in Garmin Connect → widget settings |
| Task shows `0x1` in Last Run Result | The server exited | `.trainbud/logs/server.err.log` |
| Watchdog logs `no tunnel service installed` | The tunnel is running in a terminal, not as a service | Install it as a service (Section 1), or run the watchdog with `-SkipPublic` |
| Everything green, watch still shows nothing | Widget URL points at the old hostname | Garmin Connect → widget settings. A sideloaded build has the host **baked in** at `ciq/resources-dev/settings/properties.xml` and needs a rebuild |

Related: [WEB-MCP.md](./WEB-MCP.md) · [../ciq/README.md](../ciq/README.md)
