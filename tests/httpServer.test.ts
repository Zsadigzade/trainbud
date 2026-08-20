import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { HttpMcpServer } from "../src/httpServer.js";

describe("http MCP server", () => {
  const originalEnv = {
    email: process.env.GARMIN_EMAIL,
    password: process.env.GARMIN_PASSWORD,
    apiKey: process.env.TRAINBUD_API_KEY,
    port: process.env.TRAINBUD_PORT,
    host: process.env.TRAINBUD_HOST,
  };

  let server: HttpMcpServer;
  const baseUrl = "http://127.0.0.1:3848";

  before(async () => {
    process.env.GARMIN_EMAIL = process.env.GARMIN_EMAIL ?? "test@example.com";
    process.env.GARMIN_PASSWORD = process.env.GARMIN_PASSWORD ?? "test-password";
    process.env.TRAINBUD_API_KEY = "test-api-key-123";
    process.env.TRAINBUD_PORT = "3848";
    process.env.TRAINBUD_HOST = "127.0.0.1";

    const { createHttpMcpServer } = await import("../src/httpServer.js");
    server = createHttpMcpServer();
    await server.start();
  });

  after(async () => {
    await server.close();

    process.env.GARMIN_EMAIL = originalEnv.email;
    process.env.GARMIN_PASSWORD = originalEnv.password;
    process.env.TRAINBUD_API_KEY = originalEnv.apiKey;
    process.env.TRAINBUD_PORT = originalEnv.port;
    process.env.TRAINBUD_HOST = originalEnv.host;
  });

  it("returns health without authentication", async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { status: string };
    assert.equal(body.status, "ok");
  });

  it("rejects MCP requests without bearer token", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", params: {}, id: 1 }),
    });

    assert.equal(response.status, 401);
  });

  it("rejects watch API requests without bearer token", async () => {
    const response = await fetch(`${baseUrl}/api/watch`);
    assert.equal(response.status, 401);
  });

  it("accepts MCP requests with valid bearer token", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-api-key-123",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
        id: 1,
      }),
    });

    assert.ok(response.status >= 200 && response.status < 500);
  });
});

describe("request log redaction", () => {
  it("redacts the dashboard token from a logged query string", async () => {
    const { redactQuery } = await import("../src/httpServer.js");
    assert.equal(redactQuery("?token=supersecret"), "?token=<redacted>");
  });

  it("redacts credential-ish parameters but keeps diagnostics readable", async () => {
    const { redactQuery } = await import("../src/httpServer.js");
    const out = redactQuery("?build=b3&api_key=abc&attempts=4");
    assert.ok(out.includes("build=b3"));
    assert.ok(out.includes("attempts=4"));
    assert.ok(!out.includes("abc"));
  });

  // Kept apart from readFormOrJsonField, which returns null for any non-string
  // JSON value so that a pair code -- zero-padded, and unrepresentable as a
  // number -- cannot be silently coerced.
  it("reads a row id sent as a JSON number, a JSON string, or a form field", async () => {
    const { readNumericField } = await import("../src/httpServer.js");
    assert.equal(readNumericField('{"id": 5}', "id"), 5);
    assert.equal(readNumericField('{"id": "5"}', "id"), 5);
    assert.equal(readNumericField("id=5", "id"), 5);
    assert.equal(readNumericField('{"id": null}', "id"), null);
    assert.equal(readNumericField('{"id": "abc"}', "id"), null);
    assert.equal(readNumericField('{"id":', "id"), null);
    assert.equal(readNumericField("", "id"), null);
  });

  it("leaves a query without secrets untouched", async () => {
    const { redactQuery } = await import("../src/httpServer.js");
    assert.equal(redactQuery("?build=b3&attempts=4"), "?build=b3&attempts=4");
  });

  it("handles an absent or empty query", async () => {
    const { redactQuery } = await import("../src/httpServer.js");
    assert.equal(redactQuery(""), "");
    assert.equal(redactQuery("?"), "");
    assert.equal(redactQuery(undefined), "");
  });
});

describe("public URL resolution for pairing", () => {
  const makeReq = (headers: Record<string, string>) =>
    ({ headers }) as unknown as import("node:http").IncomingMessage;

  it("uses the tunnel host the request actually arrived on", async () => {
    const { resolvePublicUrl } = await import("../src/httpServer.js");
    delete process.env.TRAINBUD_PUBLIC_URL;
    const url = resolvePublicUrl(makeReq({ host: "abc.ngrok-free.dev", "x-forwarded-proto": "https" }));
    assert.equal(url, "https://abc.ngrok-free.dev");
  });

  it("prefers x-forwarded-host when a proxy sets it", async () => {
    const { resolvePublicUrl } = await import("../src/httpServer.js");
    delete process.env.TRAINBUD_PUBLIC_URL;
    const url = resolvePublicUrl(
      makeReq({ host: "127.0.0.1:3847", "x-forwarded-host": "abc.ngrok-free.dev" })
    );
    assert.equal(url, "https://abc.ngrok-free.dev");
  });

  it("lets an explicit TRAINBUD_PUBLIC_URL win", async () => {
    const { resolvePublicUrl } = await import("../src/httpServer.js");
    process.env.TRAINBUD_PUBLIC_URL = "https://configured.example.com";
    try {
      const url = resolvePublicUrl(makeReq({ host: "abc.ngrok-free.dev" }));
      assert.equal(url, "https://configured.example.com");
    } finally {
      delete process.env.TRAINBUD_PUBLIC_URL;
    }
  });

  it("does not hand a watch a loopback address it can never reach", async () => {
    const { resolvePublicUrl } = await import("../src/httpServer.js");
    delete process.env.TRAINBUD_PUBLIC_URL;
    const url = resolvePublicUrl(makeReq({ host: "127.0.0.1:3847" }));
    assert.notEqual(url, "https://127.0.0.1:3847");
  });
});

// Pairing is the one flow that is reachable with no credential at all: POST
// /api/pair mints a code, and GET /api/pair/<code>/status hands back the API
// key once that code is approved. Unthrottled, six digits is a space a tunnel
// client can walk in minutes, so the pair endpoints carry their own, tighter
// budget than the general one.
describe("pair endpoint rate limiting", () => {
  const originalEnv = {
    email: process.env.GARMIN_EMAIL,
    password: process.env.GARMIN_PASSWORD,
    apiKey: process.env.TRAINBUD_API_KEY,
    port: process.env.TRAINBUD_PORT,
    host: process.env.TRAINBUD_HOST,
  };

  let server: import("../src/httpServer.js").HttpMcpServer;
  const baseUrl = "http://127.0.0.1:3849";

  before(async () => {
    process.env.GARMIN_EMAIL = process.env.GARMIN_EMAIL ?? "test@example.com";
    process.env.GARMIN_PASSWORD = process.env.GARMIN_PASSWORD ?? "test-password";
    process.env.TRAINBUD_API_KEY = "test-api-key-123";
    process.env.TRAINBUD_PORT = "3849";
    process.env.TRAINBUD_HOST = "127.0.0.1";

    const { createHttpMcpServer } = await import("../src/httpServer.js");
    server = createHttpMcpServer();
    await server.start();
  });

  after(async () => {
    await server.close();
    process.env.GARMIN_EMAIL = originalEnv.email;
    process.env.GARMIN_PASSWORD = originalEnv.password;
    process.env.TRAINBUD_API_KEY = originalEnv.apiKey;
    process.env.TRAINBUD_PORT = originalEnv.port;
    process.env.TRAINBUD_HOST = originalEnv.host;
  });

  it("stops a walk through the pair code space", async () => {
    let sawTooManyRequests = false;

    for (let i = 0; i < 40; i++) {
      const code = String(100000 + i);
      const response = await fetch(`${baseUrl}/api/pair/${code}/status`, {
        // Every request through a tunnel arrives from the tunnel agent on
        // loopback, so the forwarded client address is what identifies a
        // caller. It also keeps this test in a bucket of its own.
        headers: { "X-Forwarded-For": "203.0.113.7" },
      });
      if (response.status === 429) {
        sawTooManyRequests = true;
        break;
      }
    }

    assert.ok(sawTooManyRequests, "40 status polls in a row were all served");
  });

  it("does not punish a different client for that walk", async () => {
    const response = await fetch(`${baseUrl}/api/pair/999999/status`, {
      headers: { "X-Forwarded-For": "203.0.113.99" },
    });
    assert.equal(response.status, 404, "a separate client was rate limited by another client's traffic");
  });

  it("rejects a wrong-length token without crashing the request", async () => {
    // A constant-time comparison throws on mismatched lengths if the guard is
    // missing, which turns a 401 into a 500 or a dropped socket.
    const response = await fetch(`${baseUrl}/api/watch`, {
      headers: { Authorization: "Bearer x", "X-Forwarded-For": "203.0.113.20" },
    });
    assert.equal(response.status, 401);
  });

  it("still accepts the correct token", async () => {
    const response = await fetch(`${baseUrl}/dashboard/status`, {
      headers: { Authorization: "Bearer test-api-key-123", "X-Forwarded-For": "203.0.113.21" },
    });
    assert.equal(response.status, 200);
  });
});

// Goals and injuries are the personalisation that makes a finding worth
// anything. Without these routes they can only be entered by talking to Claude,
// so for an open-source project most people never reach the differentiator.
describe("dashboard context routes", () => {
  const originalEnv = {
    email: process.env.GARMIN_EMAIL,
    password: process.env.GARMIN_PASSWORD,
    apiKey: process.env.TRAINBUD_API_KEY,
    port: process.env.TRAINBUD_PORT,
    host: process.env.TRAINBUD_HOST,
  };

  let server: import("../src/httpServer.js").HttpMcpServer;
  let historyDir: string;
  const baseUrl = "http://127.0.0.1:3850";

  before(async () => {
    // The server opens the history database at its default path, so without
    // this the test writes goals and injuries into the developer's own store.
    // Opening a temp one first wins, because the handle is a lazy singleton.
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { closeHistoryDb, openHistoryDb } = await import("../src/history/store.js");

    historyDir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-http-history-"));
    closeHistoryDb();
    openHistoryDb(path.join(historyDir, "history.db"));

    process.env.GARMIN_EMAIL = process.env.GARMIN_EMAIL ?? "test@example.com";
    process.env.GARMIN_PASSWORD = process.env.GARMIN_PASSWORD ?? "test-password";
    process.env.TRAINBUD_API_KEY = "test-api-key-123";
    process.env.TRAINBUD_PORT = "3850";
    process.env.TRAINBUD_HOST = "127.0.0.1";

    const { createHttpMcpServer } = await import("../src/httpServer.js");
    server = createHttpMcpServer();
    await server.start();
  });

  after(async () => {
    await server.close();

    const fs = await import("node:fs");
    const { closeHistoryDb } = await import("../src/history/store.js");
    closeHistoryDb();
    fs.rmSync(historyDir, { recursive: true, force: true });

    process.env.GARMIN_EMAIL = originalEnv.email;
    process.env.GARMIN_PASSWORD = originalEnv.password;
    process.env.TRAINBUD_API_KEY = originalEnv.apiKey;
    process.env.TRAINBUD_PORT = originalEnv.port;
    process.env.TRAINBUD_HOST = originalEnv.host;
  });

  function post(path: string, body: unknown, token?: string): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Forwarded-For": "203.0.113.40",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return fetch(`${baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  }

  it("rejects an unauthenticated write", async () => {
    const response = await post("/dashboard/context", { kind: "goal", text: "x" });
    assert.equal(response.status, 401);
  });

  it("rejects an unauthenticated close", async () => {
    const response = await post("/dashboard/context/close", { id: 1 });
    assert.equal(response.status, 401);
  });

  it("records an entry and hands back its id", async () => {
    const response = await post(
      "/dashboard/context",
      { kind: "race", text: "Baku Half Marathon", effective_to: "2026-10-12" },
      "test-api-key-123"
    );

    assert.equal(response.status, 200);
    const body = (await response.json()) as { ok: boolean; id: number };
    assert.equal(body.ok, true);
    assert.ok(body.id > 0);
  });

  it("names the valid kinds when given a bad one", async () => {
    const response = await post(
      "/dashboard/context",
      { kind: "workout", text: "x" },
      "test-api-key-123"
    );

    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /goal, race, injury, note/);
  });

  it("refuses an entry with no text", async () => {
    const response = await post(
      "/dashboard/context",
      { kind: "goal", text: "   " },
      "test-api-key-123"
    );

    assert.equal(response.status, 400);
  });

  it("closes an entry it created", async () => {
    const created = await post(
      "/dashboard/context",
      { kind: "injury", text: "Left achilles" },
      "test-api-key-123"
    );
    const { id } = (await created.json()) as { id: number };

    const closed = await post("/dashboard/context/close", { id }, "test-api-key-123");
    assert.equal(closed.status, 200);
    assert.deepEqual(await closed.json(), { ok: true });
  });

  it("reports a close of an entry that is not there", async () => {
    const response = await post("/dashboard/context/close", { id: 999999 }, "test-api-key-123");

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: false });
  });
});
