import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { HttpMcpServer } from "../src/httpServer.js";

/**
 * A body this server cannot parse is the client's mistake, and /mcp reported it
 * as its own: HTTP 500 with JSON-RPC -32603 "Internal server error", which is
 * the code reserved for a fault inside the server. JSON-RPC 2.0 defines -32700
 * for exactly this case.
 *
 * It matters beyond correctness. This endpoint is reachable through a public
 * tunnel whenever the watch is set up, so anything scanning it produces a
 * server-error line for every malformed probe -- and since a genuine 500 is
 * worth investigating, the two become indistinguishable in the log.
 */
describe("a request this server cannot parse is the client's fault", () => {
  const originalEnv = {
    email: process.env.GARMIN_EMAIL,
    password: process.env.GARMIN_PASSWORD,
    apiKey: process.env.TRAINBUD_API_KEY,
    port: process.env.TRAINBUD_PORT,
    host: process.env.TRAINBUD_HOST,
  };

  let server: HttpMcpServer;
  const port = 3872;
  const url = `http://127.0.0.1:${port}/mcp`;
  const headers = {
    Authorization: "Bearer test-api-key-123",
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };

  before(async () => {
    process.env.GARMIN_EMAIL = process.env.GARMIN_EMAIL ?? "test@example.com";
    process.env.GARMIN_PASSWORD = process.env.GARMIN_PASSWORD ?? "test-password";
    process.env.TRAINBUD_API_KEY = "test-api-key-123";
    process.env.TRAINBUD_PORT = String(port);
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

  it("answers malformed JSON with 400 and a parse error, not 500", async () => {
    const response = await fetch(url, { method: "POST", headers, body: "{not json" });
    const body = (await response.json()) as { error?: { code?: number; message?: string } };

    assert.equal(response.status, 400, "a body we cannot parse is a client error");
    assert.equal(body.error?.code, -32700, "JSON-RPC reserves -32700 for a parse error");
    assert.match(String(body.error?.message), /parse/i);
  });

  it("answers a body past the limit with 413 rather than a server error", async () => {
    const oversized = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { padding: "x".repeat(1024 * 1024 + 512) },
    });

    const response = await fetch(url, { method: "POST", headers, body: oversized });
    const body = (await response.json()) as { error?: { code?: number } };

    assert.equal(response.status, 413, "an oversized body is a client error too");
    assert.equal(body.error?.code, -32600);
  });

  it("still serves a well-formed request", async () => {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(text, /get_findings/);
  });
});
