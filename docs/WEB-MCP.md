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

1. Open [claude.ai](https://claude.ai) → **Settings** → **Connectors**
2. **Add custom connector**
3. **URL:** `https://YOUR-TUNNEL-URL/mcp`
4. **Authentication:** Bearer token → paste `TRAINBUD_API_KEY` from `.env`
5. Save and enable the connector in chat

Claude.ai supports Streamable HTTP MCP — this is the most reliable web target.

Test with: *"What was my last Garmin workout?"*

## 4. Connect ChatGPT (Developer Mode)

ChatGPT MCP support varies by plan and region. After Claude.ai works:

1. Open ChatGPT → **Settings** → **Connectors** (or Developer Mode)
2. Create MCP connector
3. **Server URL:** `https://YOUR-TUNNEL-URL/mcp`
4. **Auth:** Bearer token with `TRAINBUD_API_KEY`

**Known quirk:** ChatGPT may handle auth headers differently than Claude.ai. If connection fails:

- Verify the tunnel URL responds: `curl https://YOUR-TUNNEL-URL/health`
- Test MCP with auth: `curl -H "Authorization: Bearer YOUR_KEY" -X POST https://YOUR-TUNNEL-URL/mcp`
- Try regenerating `TRAINBUD_API_KEY` in `.env` and restarting `trainbud serve`

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
| 401 Unauthorized | Check Bearer token matches `.env` exactly |
| 429 Too Many Requests | Wait 60 seconds (rate limit: 60 req/min per IP) |
| Connector timeout | Ensure tunnel is running and `trainbud serve` is active |
| No Garmin data | Run `trainbud check` to verify Garmin API access |

## Desktop vs web summary

| Client | Command | Transport |
|--------|---------|-----------|
| Cursor, Claude Desktop | `trainbud start` | stdio (local) |
| claude.ai, ChatGPT web | `trainbud serve` + HTTPS tunnel | Streamable HTTP |

See also: [QUICKSTART.md](../QUICKSTART.md), [examples/prompts.md](../examples/prompts.md)
