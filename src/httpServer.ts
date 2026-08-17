import type { IncomingMessage, ServerResponse } from "node:http";
import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { closeCache } from "./garmin/cache.js";
import { closeAppDb, setSetting } from "./appDb.js";
import { assertGarminCredentials, assertApiKey, appConfig } from "./config.js";
import { createMcpServerInstance } from "./server.js";
import { configureLogger, logger } from "./utils/logger.js";
import { buildWatchSummary, type WatchSummary } from "./watchApi.js";
import { requestPairing, checkPairStatus, approvePairing } from "./pairApi.js";
import { submitPrompt, getPromptStatus } from "./promptApi.js";
import { renderDashboard, renderPairSuccess, renderPairError } from "./dashboard.js";

// SECTION: HTTP MCP Server

const MAX_BODY_BYTES = 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const WATCH_API_CACHE_TTL_MS = 5 * 60_000;

const requestLog = new Map<string, { count: number; windowStart: number }>();
let watchApiCache: { summary: WatchSummary; expiresAt: number } | null = null;

export interface HttpMcpServer {
  start: () => Promise<void>;
  close: () => Promise<void>;
}

function getClientKey(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? "unknown";
}

function isRateLimited(clientKey: string): boolean {
  const now = Date.now();
  const entry = requestLog.get(clientKey);

  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    requestLog.set(clientKey, { count: 1, windowStart: now });
    return false;
  }

  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function isAuthorized(req: IncomingMessage, queryToken?: string): boolean {
  const header = req.headers.authorization;
  const headerToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
  const token = headerToken ?? queryToken ?? null;
  return token !== null && token.length > 0 && token === appConfig.mcpApiKey;
}

async function getCachedWatchSummary(): Promise<WatchSummary> {
  const now = Date.now();
  if (watchApiCache && now < watchApiCache.expiresAt) {
    return watchApiCache.summary;
  }

  const summary = await buildWatchSummary();
  watchApiCache = {
    summary,
    expiresAt: now + WATCH_API_CACHE_TTL_MS,
  };
  return summary;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;

    if (total > MAX_BODY_BYTES) {
      throw new Error("Request body too large");
    }

    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return undefined;
  }

  return JSON.parse(raw) as unknown;
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isAuthorized(req)) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="trainbud"');
    sendJson(res, 401, {
      error: "Unauthorized",
      message: "Missing or invalid Authorization: Bearer token.",
    });
    return;
  }

  const clientKey = getClientKey(req);
  if (isRateLimited(clientKey)) {
    sendJson(res, 429, {
      error: "Too Many Requests",
      message: "Rate limit exceeded. Try again in a minute.",
    });
    return;
  }

  const server = createMcpServerInstance();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);

    const parsedBody = req.method === "POST" ? await readJsonBody(req) : undefined;
    await transport.handleRequest(req, res, parsedBody);
  } catch (error) {
    logger.error({ error }, "HTTP MCP request failed");

    if (!res.headersSent) {
      sendJson(res, 500, {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  } finally {
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
  }
}

export function createHttpMcpServer(): HttpMcpServer {
  let httpServer: http.Server | null = null;

  return {
    async start(): Promise<void> {
      assertGarminCredentials();
      assertApiKey();
      configureLogger(appConfig.logPath);

      // Load Claude key saved via dashboard into process.env if not already set
      const savedClaudeKey = (await import("./appDb.js")).getSetting("anthropic_api_key");
      if (savedClaudeKey && !process.env["ANTHROPIC_API_KEY"]) {
        process.env["ANTHROPIC_API_KEY"] = savedClaudeKey;
      }

      httpServer = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        const pathname = normalizePathname(url.pathname);

        if (pathname === "/" || pathname === "") {
          sendJson(res, 200, {
            service: "trainbud",
            endpoints: {
              health: "/health",
              watch: "/api/watch",
              pair: "/api/pair",
              prompt: "/api/prompt",
              dashboard: "/dashboard",
              mcp: "/mcp",
            },
            message: "Dashboard: GET /dashboard?token=YOUR_API_KEY",
          });
          return;
        }

        if (pathname === "/health") {
          sendJson(res, 200, { status: "ok", service: "trainbud" });
          return;
        }

        // --- Pairing ---

        if (pathname === "/api/pair" && req.method === "POST") {
          const result = requestPairing();
          sendJson(res, 200, result);
          return;
        }

        if (pathname.startsWith("/api/pair/") && pathname.endsWith("/status") && req.method === "GET") {
          const code = pathname.slice("/api/pair/".length, -"/status".length);
          const status = checkPairStatus(code);
          if (!status) {
            sendJson(res, 404, { error: "Pair code not found or expired" });
          } else {
            sendJson(res, 200, status);
          }
          return;
        }

        // --- Prompt ---

        if (pathname === "/api/prompt" && req.method === "POST") {
          if (!isAuthorized(req)) {
            res.setHeader("WWW-Authenticate", 'Bearer realm="trainbud"');
            sendJson(res, 401, { error: "Unauthorized" });
            return;
          }

          let body: unknown;
          try {
            body = await readJsonBody(req);
          } catch {
            sendJson(res, 400, { error: "Invalid JSON body" });
            return;
          }

          if (typeof body !== "object" || body === null || typeof (body as Record<string, unknown>)["prompt"] !== "string") {
            sendJson(res, 400, { error: "Missing prompt field" });
            return;
          }

          const prompt = ((body as Record<string, unknown>)["prompt"] as string).trim();
          if (prompt.length === 0 || prompt.length > 500) {
            sendJson(res, 400, { error: "Prompt must be 1–500 characters" });
            return;
          }

          const result = submitPrompt(prompt);
          sendJson(res, 202, result);
          return;
        }

        if (pathname.startsWith("/api/prompt/") && req.method === "GET") {
          if (!isAuthorized(req)) {
            res.setHeader("WWW-Authenticate", 'Bearer realm="trainbud"');
            sendJson(res, 401, { error: "Unauthorized" });
            return;
          }

          const jobId = pathname.slice("/api/prompt/".length);
          const status = getPromptStatus(jobId);
          if (!status) {
            sendJson(res, 404, { error: "Job not found" });
          } else {
            sendJson(res, 200, status);
          }
          return;
        }

        // --- Dashboard ---

        const queryToken = url.searchParams.get("token") ?? undefined;

        if (pathname === "/dashboard") {
          if (!isAuthorized(req, queryToken)) {
            res.setHeader("WWW-Authenticate", 'Bearer realm="trainbud"');
            res.writeHead(401, { "Content-Type": "text/html" });
            res.end("<h1>401 Unauthorized</h1><p>Add <code>Authorization: Bearer YOUR_API_KEY</code> header, or use the URL <code>/dashboard?token=YOUR_API_KEY</code></p>");
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderDashboard());
          return;
        }

        if (pathname === "/dashboard/pair/approve" && req.method === "POST") {
          if (!isAuthorized(req, queryToken)) {
            res.setHeader("WWW-Authenticate", 'Bearer realm="trainbud"');
            res.writeHead(401, { "Content-Type": "text/html" });
            res.end("<h1>401 Unauthorized</h1>");
            return;
          }

          let formCode: string | null = null;
          try {
            const raw = await readJsonBody(req) as Record<string, string> | undefined;
            if (raw && typeof raw["code"] === "string") {
              formCode = raw["code"];
            }
          } catch {
            // Try reading as URL-encoded form
          }

          if (!formCode) {
            // Read as URL-encoded form
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const raw = Buffer.concat(chunks).toString("utf8");
            const params = new URLSearchParams(raw);
            formCode = params.get("code");
          }

          if (!formCode) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end(renderPairError("Missing code parameter."));
            return;
          }

          const ok = approvePairing(formCode);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(ok ? renderPairSuccess(formCode) : renderPairError("Code not found or expired."));
          return;
        }

        if (pathname === "/dashboard/settings" && req.method === "POST") {
          if (!isAuthorized(req, queryToken)) {
            res.setHeader("WWW-Authenticate", 'Bearer realm="trainbud"');
            res.writeHead(401, { "Content-Type": "text/html" });
            res.end("<h1>401 Unauthorized</h1>");
            return;
          }

          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const raw = Buffer.concat(chunks).toString("utf8");
          const params = new URLSearchParams(raw);
          const key = params.get("anthropic_api_key")?.trim();

          if (key && key.length > 0) {
            setSetting("anthropic_api_key", key);
            process.env["ANTHROPIC_API_KEY"] = key;
          }

          res.writeHead(302, { Location: "/dashboard" });
          res.end();
          return;
        }

        if (pathname === "/api/watch") {
          if (req.method !== "GET") {
            sendJson(res, 405, { error: "Method Not Allowed", message: "Use GET for /api/watch." });
            return;
          }

          if (!isAuthorized(req)) {
            res.setHeader("WWW-Authenticate", 'Bearer realm="trainbud"');
            sendJson(res, 401, {
              error: "Unauthorized",
              message: "Missing or invalid Authorization: Bearer token.",
            });
            return;
          }

          try {
            const summary = await getCachedWatchSummary();
            sendJson(res, 200, summary);
          } catch (error) {
            logger.error({ error }, "Watch API request failed");
            sendJson(res, 500, {
              error: "Internal Server Error",
              message: "Failed to build watch summary.",
            });
          }
          return;
        }

        if (pathname === "/mcp") {
          if (req.method !== "POST") {
            sendJson(res, 405, {
              jsonrpc: "2.0",
              error: {
                code: -32000,
                message: "Method not allowed. Use POST for MCP requests.",
              },
              id: null,
            });
            return;
          }

          await handleMcpRequest(req, res);
          return;
        }

        sendJson(res, 404, { error: "Not Found" });
      });

      await new Promise<void>((resolve, reject) => {
        httpServer!.listen(appConfig.mcpPort, appConfig.mcpHost, (error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      logger.info(
        { host: appConfig.mcpHost, port: appConfig.mcpPort },
        "TrainBud HTTP MCP server listening"
      );
    },
    async close(): Promise<void> {
      if (!httpServer) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        httpServer!.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      httpServer = null;
      watchApiCache = null;
      closeCache();
      closeAppDb();
    },
  };
}

export function getRemoteConnectorInstructions(publicUrl: string): string {
  return [
    "Remote MCP connector setup:",
    "",
    `1. Start the server: trainbud serve`,
    `2. Expose HTTPS (e.g. Cloudflare Tunnel): cloudflared tunnel --url http://127.0.0.1:${appConfig.mcpPort}`,
    `3. Use your public URL + /mcp as the connector endpoint`,
    "",
    "Claude.ai:",
    "- Settings → Connectors → Add custom connector",
    `- URL: ${publicUrl.replace(/\/$/, "")}/mcp`,
    "- Authentication: Bearer token (your TRAINBUD_API_KEY from .env)",
    "",
    "ChatGPT (Developer Mode):",
    "- Settings → Connectors → create MCP connector",
    `- Server URL: ${publicUrl.replace(/\/$/, "")}/mcp`,
    "- Auth: Bearer token with TRAINBUD_API_KEY",
    "- Note: ChatGPT MCP auth behavior may differ; test after Claude.ai works",
    "",
    `Health check: ${publicUrl.replace(/\/$/, "")}/health`,
  ].join("\n");
}
