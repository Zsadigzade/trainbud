# Web MCP Setup (claude.ai, ChatGPT, and other remote connectors)

TrainBud supports **remote MCP** via Streamable HTTP so web AI platforms can access your Garmin data. Desktop clients (Cursor, Claude Desktop) continue to use `trainbud start` (stdio).

The same HTTP server also powers the **Garmin Connect IQ watch widget** — it calls `GET /api/watch` instead of `/mcp`. See [ciq/README.md](../ciq/README.md).

## Prerequisites

- Completed `trainbud setup` (creates `TRAINBUD_API_KEY` in `.env`)
- HTTPS public URL (required by web AI platforms — use a tunnel for personal use)

## 1. Start the HTTP server

```bash
trainbud serve
```

Defaults:
- Host: `127.0.0.1` (`TRAINBUD_HOST`)
- Port: `3847` (`TRAINBUD_PORT`)
- MCP endpoint: `http://127.0.0.1:3847/mcp`
- Health check: `http://127.0.0.1:3847/health`
- Watch summary: `http://127.0.0.1:3847/api/watch` (Connect IQ widget — see [ciq/README.md](../ciq/README.md))

All `/mcp` requests require:

```http
Authorization: Bearer YOUR_TRAINBUD_API_KEY
```

Find your key in `.env` as `TRAINBUD_API_KEY`.

## 2. Expose via HTTPS (Cloudflare Tunnel — recommended)

Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), then:

```bash
# Terminal 1
trainbud serve

# Terminal 2
cloudflared tunnel --url http://127.0.0.1:3847
```

Copy the `https://*.trycloudflare.com` URL from cloudflared output.

Your MCP connector URL is:

```text
https://YOUR-TUNNEL-URL/mcp
```

### Alternative: ngrok

```bash
ngrok http 3847
```

Use `https://YOUR-NGROK-URL/mcp` as the connector endpoint.

## 3. Connect claude.ai (best first target)

Verified against the live UI on 2026-09-11. Adding a connector is **two steps**,
and the authentication page will steer you wrong if you let it.

1. Open **[claude.ai/customize/connectors](https://claude.ai/customize/connectors)**
   → **Add**.

   > `claude.ai/settings/connectors` now only says *"Connectors have moved to
   > Customize"*. Older guides — including earlier versions of this file — send
   > you to a page that no longer does anything.

2. **Step 1 of 2** — fill in:

   | Field | Value |
   |---|---|
   | Name | `TrainBud` |
   | MCP server URL | `https://YOUR-TUNNEL-URL/mcp` |

3. **Step 2 of 2 — choose `No sign-in`.**

   > [!WARNING]
   > The *Sign in now* option will be tagged **Detected**. **It is wrong.**
   > Claude probes the server, sees TrainBud's `401` carrying
   > `WWW-Authenticate: Bearer realm="trainbud"`, and reads that as an OAuth
   > flow. TrainBud has **no OAuth endpoints at all** — it compares one static
   > bearer string. Picking the detected option produces a connector that can
   > never sign in.
   >
   > Claude's own note under *No sign-in* says the right thing: *"If the server
   > uses an API key instead of OAuth, add it under Request headers below."*

4. Under **Request headers**, click **Add header**:

   | Field | Value |
   |---|---|
   | Header name | `authorization` (pick it from the dropdown) |
   | Value | `Bearer YOUR_TRAINBUD_API_KEY` |
   | Required | ✅ |

   > [!IMPORTANT]
   > **The `Bearer ` prefix goes in the value.** The page states it: *"Include
   > the auth scheme in the value... The value is sent exactly as entered."*
   > Without it, the whole header is compared against your raw key and every
   > request returns 401.
   >
   > Your key is the `TRAINBUD_API_KEY=` line in `.env`. The surrounding single
   > quotes are **not** part of the key.

5. **Add**, then **Connect** on the connector's page.

### Check the server, not the tick

A connector page saying *Connected* is a claim about claude.ai's state. The
evidence is in your own log:

```bash
# Windows
Get-Content .trainbud\logs\server.log -Tail 40 | Select-String '"path":"/mcp"'
```

A working connection shows several `POST /mcp` with `"ua":"Claude-User"` and
**no 401s**. Then enable TrainBud in a chat and ask *"What did I do today?"*

## 4. Connect ChatGPT (Developer Mode)

ChatGPT MCP support varies by plan and region. Do this only after claude.ai works.

1. Open ChatGPT → **Settings** → **Connectors** (or Developer Mode)
2. Create MCP connector
3. **Server URL:** `https://YOUR-TUNNEL-URL/mcp`
4. **Auth:** an `Authorization: Bearer YOUR_TRAINBUD_API_KEY` header

**Known quirk:** ChatGPT may handle auth headers differently from claude.ai. If
the connection fails, work outward from the server:

```bash
curl https://YOUR-TUNNEL-URL/health
curl -H "Authorization: Bearer YOUR_KEY" -X POST https://YOUR-TUNNEL-URL/mcp
```

If `/health` answers but `/mcp` 401s, the key is wrong or the scheme is missing.
If `/health` returns HTML rather than JSON, the tunnel is up and the server is
not — see [ALWAYS-ON.md](./ALWAYS-ON.md).

## 5. Gemini and Perplexity

| Platform | MCP on web | Recommendation |
|----------|------------|----------------|
| **Gemini (web)** | Not supported natively | Use Gemini CLI with local stdio, or claude.ai/ChatGPT |
| **Perplexity** | Limited / evolving | Test after HTTP server works; may require local bridge |

## Security checklist

- **Never** expose `trainbud serve` to the public internet without bearer token auth
- **Always** use HTTPS (tunnel or reverse proxy) — never paste `http://` URLs into web AI connectors
- Rotate `TRAINBUD_API_KEY` if leaked
- Keep `trainbud serve` bound to `127.0.0.1` — the tunnel handles external access
- Do not commit `.env` or share your API key

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `Missing TRAINBUD_API_KEY` | Run `trainbud setup` or add key to `.env` |
| 401 Unauthorized | Check the header value is `Bearer <key>` — the scheme is part of the value, and the quotes in `.env` are not part of the key |
| 429 Too Many Requests | Wait 60 seconds (rate limit: 60 req/min per IP) |
| Connector timeout | `trainbud doctor` — it checks the tunnel from outside, which a browser cannot. See [ALWAYS-ON.md](./ALWAYS-ON.md) |
| No Garmin data | Run `trainbud check` to verify Garmin API access |

## Desktop vs web summary

| Client | Command | Transport |
|--------|---------|-----------|
| Cursor, Claude Desktop | `trainbud start` | stdio (local) |
| claude.ai, ChatGPT web | `trainbud serve` + HTTPS tunnel | Streamable HTTP |

See also: [QUICKSTART.md](../QUICKSTART.md), [examples/prompts.md](../examples/prompts.md)
