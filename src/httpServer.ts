import type { IncomingMessage, ServerResponse } from "node:http";
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { closeCache } from "./garmin/cache.js";
import {
  CARD_IDS,
  DEFAULT_PROFILE,
  getProfile,
  updateProfile,
} from "./profile.js";
import {
  budgetState,
  clearFeatureUsage,
  dailyAiSpend,
  featureCounts,
  monthToDateSpend,
  recentAiUsage,
  recordFeature,
} from "./usage.js";
import { closeAppDb, reconcilePromptJobsOnStartup, setSetting } from "./appDb.js";
import { assertGarminCredentials, assertApiKey, appConfig } from "./config.js";
import { createMcpServerInstance } from "./server.js";
import { configureLogger, logger } from "./utils/logger.js";
import { buildWatchSummary, type WatchSummary } from "./watchApi.js";
import { requestPairing, checkPairStatus, approvePairing } from "./pairApi.js";
import { submitPrompt, getPromptStatus, isAiConfigured, clearDailyInsight } from "./promptApi.js";
import { renderDashboard, renderPairSuccess, renderPairError, getDashboardStatus } from "./dashboard.js";
import { runSelfTest } from "./selfTest.js";
import { addContextEntry, closeContextEntry } from "./history/context.js";
import { CONTEXT_KINDS, type ContextKind } from "./history/schema.js";

// SECTION: HTTP MCP Server

const MAX_BODY_BYTES = 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;
// Pairing is the only flow reachable with no credential at all, and the prize
// for guessing a code is the API key itself. Six digits is a small space, so
// these endpoints get their own, much tighter budget: a real watch polls once
// every five seconds, which is twelve requests a minute.
const PAIR_RATE_LIMIT_MAX_REQUESTS = 30;
const RATE_LIMIT_PRUNE_THRESHOLD = 256;
const WATCH_API_CACHE_TTL_MS = 5 * 60_000;

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const requestLog = new Map<string, RateLimitEntry>();
const pairRequestLog = new Map<string, RateLimitEntry>();
let watchApiCache: { summary: WatchSummary; expiresAt: number } | null = null;

/**
 * How many per-request MCP servers are still holding their transport open.
 *
 * This exists because "did that request release its handles" had no observable
 * at all: a leak was a number that only grew inside the process, so a test could
 * not tell a fixed build from a broken one, and neither could an operator. It
 * settles back to zero once every in-flight request has finished or been
 * abandoned; a value that climbs and stays there is the leak.
 */
let liveMcpSessions = 0;

export function liveMcpSessionCount(): number {
  return liveMcpSessions;
}

export interface HttpMcpServer {
  start: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Who to charge a request to.
 *
 * The socket address alone was wrong for the deployment this server actually
 * runs in: behind a tunnel every request arrives from the tunnel agent on
 * loopback, so the watch, the dashboard and a stranger all shared one bucket --
 * one noisy client throttled everyone, and an attacker walking the pair code
 * space was indistinguishable from the watch.
 *
 * The forwarded address is only trusted when the request came from loopback,
 * i.e. from a local tunnel agent; a direct caller cannot promote itself by
 * inventing the header. The last hop is used, not the first, because a client
 * can send its own X-Forwarded-For and the proxy appends the address it
 * actually saw.
 */
function getClientKey(req: IncomingMessage): string {
  const socketAddress = req.socket.remoteAddress ?? "unknown";
  if (!isLoopbackAddress(socketAddress)) {
    return socketAddress;
  }

  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
  const hops = (raw ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter((hop) => hop.length > 0);

  return hops.length > 0 ? hops[hops.length - 1]! : socketAddress;
}

function isLoopbackAddress(address: string): boolean {
  const name = address.replace(/^::ffff:/, "");
  return name === "127.0.0.1" || name === "::1" || name.startsWith("127.");
}

/** Drop windows that have already rolled over, so the map cannot grow forever. */
function pruneRateLimitLog(log: Map<string, RateLimitEntry>, now: number): void {
  if (log.size < RATE_LIMIT_PRUNE_THRESHOLD) {
    return;
  }
  for (const [key, entry] of log) {
    if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
      log.delete(key);
    }
  }
}

function isRateLimited(
  clientKey: string,
  log: Map<string, RateLimitEntry> = requestLog,
  max: number = RATE_LIMIT_MAX_REQUESTS
): boolean {
  const now = Date.now();
  pruneRateLimitLog(log, now);
  const entry = log.get(clientKey);

  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    log.set(clientKey, { count: 1, windowStart: now });
    return false;
  }

  entry.count += 1;
  return entry.count > max;
}

/** True for the endpoints that can be reached without a credential. */
function isPairPath(pathname: string): boolean {
  return pathname === "/api/pair" || pathname.startsWith("/api/pair/");
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * The dashboard drives these endpoints over fetch and expects JSON; a plain
 * browser form post still gets HTML. Keeps the no-JavaScript path working.
 */
function wantsJson(req: IncomingMessage): boolean {
  return (req.headers.accept ?? "").includes("application/json");
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
  return token !== null && matchesApiKey(token);
}

/**
 * Constant-time comparison. `===` returns as soon as two bytes differ, which
 * leaks the length of the matching prefix to anyone who can time the response,
 * and this key is reachable over a public tunnel. timingSafeEqual throws on a
 * length mismatch, so the lengths are compared first -- that leaks only the
 * key's length, which is fixed and public anyway.
 */
function matchesApiKey(token: string): boolean {
  const expected = appConfig.mcpApiKey;
  if (!expected || !token) {
    return false;
  }
  const provided = Buffer.from(token, "utf8");
  const secret = Buffer.from(expected, "utf8");
  if (provided.length !== secret.length) {
    return false;
  }
  return timingSafeEqual(provided, secret);
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

/** Drain the request body once, as text. */
async function readRawBody(req: IncomingMessage): Promise<string> {
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

  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Pull a field from a body that may be JSON or URL-encoded, without re-reading
 * the stream. The dashboard posts URL-encoded; API clients post JSON.
 */
export function readFormOrJsonField(raw: string, field: string): string | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const value = parsed[field];
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  }

  return new URLSearchParams(raw).get(field);
}

/**
 * Deliberately separate from readFormOrJsonField, which returns null for any
 * non-string JSON value. That is not an oversight there: a pair code is a
 * zero-padded six-digit string, `000042` is not valid JSON as a number, and
 * silently coercing 42 would turn "you sent this in a form that cannot
 * represent it" into a failed lookup.
 *
 * A row id has no such problem, and a JSON client naturally sends {"id": 5}.
 */
export function readNumericField(raw: string, field: string): number | null {
  const trimmed = raw.trim();

  if (trimmed.startsWith("{")) {
    try {
      const value = (JSON.parse(trimmed) as Record<string, unknown>)[field];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
        return Number.parseInt(value, 10);
      }
      return null;
    } catch {
      return null;
    }
  }

  const formValue = new URLSearchParams(raw).get(field);
  if (formValue !== null && /^-?\d+$/.test(formValue.trim())) {
    return Number.parseInt(formValue, 10);
  }

  return null;
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

  const server = createMcpServerInstance();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  /**
   * A per-request MCP server and transport are only released by the `close`
   * listener below, and that listener used to be registered in a `finally` --
   * after the awaits. A client that aborted mid-request (a watch losing
   * Bluetooth, a browser tab closed, a tunnel dropping) had already emitted
   * `close` by then, and `close` does not fire twice: the listener was attached
   * to a dead response and never ran. Every aborted request leaked a server, a
   * transport and their listeners for the lifetime of the process.
   *
   * Registered before the first await now, and idempotent, because the two
   * paths that reach it -- the event and the direct call when the socket is
   * already gone -- can both happen.
   */
  let released = false;
  liveMcpSessions += 1;

  const release = (): void => {
    if (released) {
      return;
    }
    released = true;
    liveMcpSessions -= 1;
    void Promise.resolve(transport.close()).catch((error: unknown) => {
      logger.debug({ err: error }, "MCP transport close failed");
    });
    void Promise.resolve(server.close()).catch((error: unknown) => {
      logger.debug({ err: error }, "MCP server close failed");
    });
  };

  res.once("close", release);

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
    // `close` cannot arrive for a response that is already destroyed, so the
    // only chance to release those handles is right here.
    if (res.destroyed || res.writableEnded) {
      release();
    }
  }
}

// Query-string parameters whose values must never be written to the log.
// The dashboard authenticates with ?token=<API key>, so request logging was
// persisting a live credential to .trainbud/mcp.log on every dashboard hit.
const REDACTED_QUERY_KEYS = new Set(["token", "api_key", "apikey", "key", "secret", "password"]);

export function redactQuery(search: string | null | undefined): string {
  if (!search || search === "?") return "";
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  let changed = false;
  for (const name of [...params.keys()]) {
    if (REDACTED_QUERY_KEYS.has(name.toLowerCase())) {
      params.set(name, "<redacted>");
      changed = true;
    }
  }
  if (!changed) return search;
  return "?" + params.toString().replace(/%3Credacted%3E/gi, "<redacted>");
}

/**
 * Redact a live pairing code out of a request path.
 *
 * The query string was redacted and the path was not, so every status poll wrote
 * `/api/pair/418902/status` into the log -- a code that is, for the next five
 * minutes, a bearer credential: `/api/pair/<code>/status` hands out the API key
 * the moment it is approved. The log file sits next to the database and, until
 * the fix above, was as readable as it was.
 *
 * The code is the thing worth hiding; the shape of the path is worth keeping,
 * because "did the watch poll at all" is the question this log exists to answer.
 */
export function redactPath(pathname: string): string {
  return pathname.replace(/^\/api\/pair\/[^/]+/, "/api/pair/<code>");
}

/**
 * Both redactions, applied to a RAW `req.url`.
 *
 * The request-logging line was fixed to redact and the unhandled-error handler
 * was not, so a 500 wrote `?token=<the live API key>` into `.trainbud/mcp.log`
 * in plaintext. Same file, same log, same key, one fix short.
 *
 * `req.url` is an origin-form path, not an absolute URL, so it cannot go
 * through `new URL()` without a base -- and this runs inside the handler whose
 * entire purpose is that nothing in it may take the process down, so it must
 * not throw on a malformed one either. Split by hand, and fall back to naming
 * the shape rather than printing the value.
 */
export function redactRequestUrl(rawUrl: string | undefined): string {
  const raw = rawUrl ?? "";
  const queryStart = raw.indexOf("?");
  const pathname = queryStart === -1 ? raw : raw.slice(0, queryStart);
  const search = queryStart === -1 ? "" : raw.slice(queryStart);

  try {
    return redactPath(pathname) + redactQuery(search);
  } catch {
    // URLSearchParams is forgiving, but a credential must not survive on the
    // strength of that assumption.
    return `${redactPath(pathname)}<unparsable query redacted>`;
  }
}

// The public URL to hand a watch during pairing.
//
// This used to come solely from appConfig.publicUrl, which falls back to
// .trainbud/watch-setup.json — a file written once by `trainbud setup` and
// never updated when the tunnel changes. A watch that paired successfully was
// therefore told to switch to a tunnel that had been dead for weeks, so pairing
// "worked" and the app went blank on the very next request. Deriving it from
// the host the request actually arrived on is correct by construction for any
// tunnel; an explicit TRAINBUD_PUBLIC_URL still wins, since that is deliberate.
export function resolvePublicUrl(req: http.IncomingMessage): string {
  const configured = (process.env["TRAINBUD_PUBLIC_URL"] ?? "").replace(/\/$/, "");
  if (configured) return configured;

  const forwardedHost = firstHeaderValue(req.headers["x-forwarded-host"]);
  const host = forwardedHost ?? req.headers.host;
  if (host && !isLocalHost(host)) {
    const proto = firstHeaderValue(req.headers["x-forwarded-proto"]) ?? "https";
    return `${proto}://${host}`.replace(/\/$/, "");
  }

  return appConfig.publicUrl;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(",")[0]?.trim() || undefined;
}

// A watch can never reach the server on a loopback address, and Connect IQ
// refuses plain http:// outright, so a local Host header means the request came
// in directly rather than through the tunnel the watch would need.
function isLocalHost(host: string): boolean {
  const name = host.split(":")[0]?.toLowerCase() ?? "";
  return name === "localhost" || name === "127.0.0.1" || name === "::1" || name === "0.0.0.0";
}

export function createHttpMcpServer(): HttpMcpServer {
  let httpServer: http.Server | null = null;

  return {
    async start(): Promise<void> {
      assertGarminCredentials();
      assertApiKey();
      configureLogger(appConfig.logPath);

      // The one process that owns prompt jobs, reclaiming its own wreckage
      // exactly once. This used to happen on every app.db open in every
      // process, which is how a CLI command killed a live watch answer.
      reconcilePromptJobsOnStartup();

      // Load Claude key saved via dashboard into process.env if not already set
      const savedClaudeKey = (await import("./appDb.js")).getSetting("anthropic_api_key");
      if (savedClaudeKey && !process.env["ANTHROPIC_API_KEY"]) {
        process.env["ANTHROPIC_API_KEY"] = savedClaudeKey;
      }

      httpServer = http.createServer((req, res) => {
        // Nothing in the handler may take the process down.
        //
        // The whole body was one unguarded `async` callback, so any throw
        // anywhere in three hundred lines became an unhandled rejection, and
        // Node has exited the process on those by default since v15. Two ways in
        // were reachable with no credential at all:
        //
        //   * `new URL(..., "http://" + req.headers.host)` was the FIRST
        //     statement, before rate limiting and before any auth check. Node's
        //     parser accepts a Host header that is not a valid URL authority
        //     ("a b", "[", "%"); new URL then throws ERR_INVALID_URL.
        //   * `await readRawBody(req)` throws on an oversized or truncated body,
        //     outside any try/catch.
        //
        // Reachability is limited in the documented deployment -- the server
        // binds loopback and a tunnel routes by Host, so a malformed Host
        // largely cannot traverse it -- but "the crash is hard to reach" is a
        // property of today's deployment, not of the code, and the fix is a
        // wrapper.
        void handleRequest(req, res).catch((error: unknown) => {
          // Redacted, like the request line above it. This wrote the dashboard's
          // ?token= -- the live API key -- into .trainbud/mcp.log on any 500.
          logger.error(
            { error, url: redactRequestUrl(req.url) },
            "Unhandled error in request handler"
          );
          if (!res.headersSent) {
            sendJson(res, 500, { error: "Internal Server Error" });
          } else if (!res.writableEnded) {
            res.end();
          }
        });
      });

      const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        // A Host that is not a valid authority is not worth a 500: fall back to
        // a name that always parses. The host only matters for reading the path
        // and, in resolvePublicUrl, for telling a paired watch where to call
        // back -- and that path validates its own input.
        let url: URL;
        try {
          url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        } catch {
          url = new URL(req.url ?? "/", "http://localhost");
        }
        const pathname = normalizePathname(url.pathname);

        // Every request, with the client's identity. Without this there is no way
        // to tell "the watch sent a request that failed" from "the watch never
        // sent one" — a distinction that decides where a pairing bug lives.
        logger.info(
          {
            method: req.method,
            // Full path including the query string. Logging url.pathname alone
            // silently dropped every query parameter, which hid diagnostics the
            // watch app was deliberately sending for exactly this purpose.
            // Redacted, because the dashboard passes the API key as ?token= and
            // this line was writing it to the log file in plaintext.
            path: redactPath(pathname) + redactQuery(url.search),
            ua: req.headers["user-agent"] ?? "(none)",
            accept: req.headers["accept"] ?? "(none)",
            encoding: req.headers["accept-encoding"] ?? "(none)",
          },
          "request"
        );

        // Rate limiting used to be wired into the MCP handler alone, so every
        // other route -- including the unauthenticated pair endpoints, the one
        // place a stranger can reach -- was unthrottled.
        const clientKey = getClientKey(req);
        const overLimit = isPairPath(pathname)
          ? isRateLimited(clientKey, pairRequestLog, PAIR_RATE_LIMIT_MAX_REQUESTS)
          : isRateLimited(clientKey);

        if (overLimit && pathname !== "/health") {
          sendJson(res, 429, {
            error: "Too Many Requests",
            message: "Rate limit exceeded. Try again in a minute.",
          });
          return;
        }

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
          const status = checkPairStatus(code, resolvePublicUrl(req));
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

          // After the auth check, never before it: a counter incremented on
          // the unauthenticated path is a counter anyone on the tunnel can
          // drive, and this one is the user's own record of what they asked.
          recordFeature("ai.ask");

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
          res.end(renderDashboard(resolvePublicUrl(req)));
          return;
        }

        if (pathname === "/dashboard/pair/approve" && req.method === "POST") {
          if (!isAuthorized(req, queryToken)) {
            res.setHeader("WWW-Authenticate", 'Bearer realm="trainbud"');
            res.writeHead(401, { "Content-Type": "text/html" });
            res.end("<h1>401 Unauthorized</h1>");
            return;
          }

          // Read the body exactly once. The previous version called
          // readJsonBody() first, which drains the stream, and on a JSON parse
          // failure tried to read the stream a second time for URL-encoded
          // data — by then it was empty, so `code` was always null and every
          // form post answered "Missing code parameter". Dashboard pairing
          // approval could never have succeeded.
          const formCode = readFormOrJsonField(await readRawBody(req), "code");

          if (!formCode) {
            if (wantsJson(req)) {
              sendJson(res, 400, { error: "Missing code parameter." });
              return;
            }
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end(renderPairError("Missing code parameter.", queryToken));
            return;
          }

          const ok = approvePairing(formCode);

          // The dashboard approves over fetch and stays on the page; the HTML
          // fallback still renders a page, now carrying the token so the "back"
          // link does not 401.
          if (wantsJson(req)) {
            sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: "Code not found or expired." });
            return;
          }

          res.writeHead(ok ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            ok
              ? renderPairSuccess(formCode, queryToken)
              : renderPairError("Code not found or expired.", queryToken)
          );
          return;
        }

        if (pathname === "/dashboard/settings" && req.method === "POST") {
          if (!isAuthorized(req, queryToken)) {
            res.setHeader("WWW-Authenticate", 'Bearer realm="trainbud"');
            res.writeHead(401, { "Content-Type": "text/html" });
            res.end("<h1>401 Unauthorized</h1>");
            return;
          }

          // Unbounded before: the body was read with no size cap, unlike every
          // other endpoint. readRawBody enforces MAX_BODY_BYTES.
          const key = readFormOrJsonField(await readRawBody(req), "anthropic_api_key")?.trim();

          if (key && key.length > 0) {
            setSetting("anthropic_api_key", key);
            process.env["ANTHROPIC_API_KEY"] = key;
            // The watch summary carries ai_configured, and it is cached for five
            // minutes. Without dropping it here the user pastes a key, the
            // dashboard says "enabled", and the watch keeps drawing "AI not set
            // up" for another five minutes -- which is exactly the confusion
            // this whole release exists to end.
            watchApiCache = null;
          }

          if (wantsJson(req)) {
            sendJson(res, 200, { ok: true, ai_configured: isAiConfigured() });
            return;
          }

          // Without the token the redirect target 401s, which is what the
          // non-JS form flow used to do after every save.
          res.writeHead(302, {
            Location: queryToken ? `/dashboard?token=${encodeURIComponent(queryToken)}` : "/dashboard",
          });
          res.end();
          return;
        }

        if (pathname === "/dashboard/context" && req.method === "POST") {
          if (!isAuthorized(req, queryToken)) {
            sendJson(res, 401, { error: "Unauthorized" });
            return;
          }

          const body = await readRawBody(req);
          const kind = readFormOrJsonField(body, "kind")?.trim() ?? "";
          const text = readFormOrJsonField(body, "text")?.trim() ?? "";
          const effectiveTo = readFormOrJsonField(body, "effective_to")?.trim();

          if (!CONTEXT_KINDS.includes(kind as ContextKind)) {
            sendJson(res, 400, {
              error: `Unknown kind "${kind}". Choose one of: ${CONTEXT_KINDS.join(", ")}.`,
            });
            return;
          }

          if (text.length === 0) {
            sendJson(res, 400, { error: "Tell me what to remember." });
            return;
          }

          try {
            const entry = addContextEntry(kind as ContextKind, text, {
              effectiveTo: effectiveTo && effectiveTo.length > 0 ? effectiveTo : undefined,
            });
            sendJson(res, 200, { ok: true, id: entry.id });
          } catch (error) {
            sendJson(res, 400, {
              error: error instanceof Error ? error.message : "Could not save that.",
            });
          }
          return;
        }

        if (pathname === "/dashboard/context/close" && req.method === "POST") {
          if (!isAuthorized(req, queryToken)) {
            sendJson(res, 401, { error: "Unauthorized" });
            return;
          }

          const id = readNumericField(await readRawBody(req), "id");

          if (id === null) {
            sendJson(res, 400, { error: "Which entry?" });
            return;
          }

          sendJson(res, 200, { ok: closeContextEntry(id) });
          return;
        }

        if (pathname === "/dashboard/status" && req.method === "GET") {
          if (!isAuthorized(req, queryToken)) {
            sendJson(res, 401, { error: "Unauthorized" });
            return;
          }
          sendJson(res, 200, getDashboardStatus(resolvePublicUrl(req)));
          return;
        }

        // What the watch would see, asked from outside this machine.
        //
        // Everything else on this server reports on itself, which is exactly
        // why the -400 report took as long as it did: the server was healthy,
        // the watch was healthy, and the broken hop was the one nothing looked
        // at. This fetches the configured public URL over the internet with the
        // watch's own headers and grades the answer the way the watch grades
        // it. Same route under /api for the CLI and for scripting.
        if (
          (pathname === "/dashboard/selftest" || pathname === "/api/selftest") &&
          req.method === "GET"
        ) {
          if (!isAuthorized(req, queryToken)) {
            sendJson(res, 401, { error: "Unauthorized" });
            return;
          }
          sendJson(res, 200, await runSelfTest());
          return;
        }

        if (pathname === "/dashboard/insight/regenerate" && req.method === "POST") {
          if (!isAuthorized(req, queryToken)) {
            sendJson(res, 401, { error: "Unauthorized" });
            return;
          }
          clearDailyInsight();
          // Drop the watch summary cache too, otherwise the next /api/watch
          // serves the old response and the insight looks unchanged.
          watchApiCache = null;
          sendJson(res, 200, { ok: true });
          return;
        }

        // Profile — read and write everything the product knows about the user
        // that Garmin does not. One endpoint for the dashboard and any other
        // client; the watch receives the resolved consequences inside
        // /api/watch rather than the settings themselves, so it never has to
        // agree with the server about where a threshold falls.
        if (pathname === "/api/profile") {
          if (!isAuthorized(req, queryToken)) {
            res.setHeader("WWW-Authenticate", 'Bearer realm="trainbud"');
            sendJson(res, 401, { error: "Unauthorized" });
            return;
          }

          if (req.method === "GET") {
            sendJson(res, 200, {
              profile: getProfile(),
              cards: CARD_IDS,
              defaults: DEFAULT_PROFILE,
            });
            return;
          }

          if (req.method === "PUT" || req.method === "POST") {
            let body: unknown;
            try {
              body = await readJsonBody(req);
            } catch {
              sendJson(res, 400, { error: "Bad Request", message: "Body must be JSON." });
              return;
            }
            if (typeof body !== "object" || body === null) {
              sendJson(res, 400, { error: "Bad Request", message: "Body must be a JSON object." });
              return;
            }

            try {
              const updated = updateProfile(body as Parameters<typeof updateProfile>[0]);
              // Units, thresholds and card order all change the bytes the watch
              // is served, and that payload is cached for five minutes. Without
              // this the user saves a setting, the dashboard confirms it, and
              // the wrist keeps drawing the old one -- the same five-minute lie
              // the API-key save had to fix.
              watchApiCache = null;
              sendJson(res, 200, { ok: true, profile: updated });
            } catch (error) {
              // The message names the field, so the dashboard can say which
              // input was refused instead of colouring the whole form red.
              sendJson(res, 400, {
                error: "Bad Request",
                message: error instanceof Error ? error.message : "Invalid profile.",
              });
            }
            return;
          }

          sendJson(res, 405, { error: "Method Not Allowed", message: "Use GET or PUT." });
          return;
        }

        // Deleting the local feature counters. "Stop counting" and "forget
        // what you counted" are different requests, and a control that only
        // does the first is not the privacy control it looks like.
        if (pathname === "/api/usage/features" && req.method === "DELETE") {
          if (!isAuthorized(req, queryToken)) {
            res.setHeader("WWW-Authenticate", 'Bearer realm="trainbud"');
            sendJson(res, 401, { error: "Unauthorized" });
            return;
          }
          clearFeatureUsage();
          sendJson(res, 200, { ok: true });
          return;
        }

        // Usage — what the AI has cost this month, and what gets opened.
        if (pathname === "/api/usage" && req.method === "GET") {
          if (!isAuthorized(req, queryToken)) {
            res.setHeader("WWW-Authenticate", 'Bearer realm="trainbud"');
            sendJson(res, 401, { error: "Unauthorized" });
            return;
          }

          sendJson(res, 200, {
            month: monthToDateSpend(),
            budget: budgetState(),
            recent: recentAiUsage(20),
            daily: dailyAiSpend(30),
            features: featureCounts(30),
          });
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

          // Which card the watch was showing. It rides along on a request the
          // watch was already making; counting it per swipe would cost a
          // request every time a wrist turns. Unknown ids are ignored rather
          // than stored, so a query string cannot mint arbitrary counter rows.
          const card = url.searchParams.get("card");
          if (card && (CARD_IDS as readonly string[]).includes(card)) {
            recordFeature(`card.${card}`);
          }
          recordFeature("watch.sync");

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
      };

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
