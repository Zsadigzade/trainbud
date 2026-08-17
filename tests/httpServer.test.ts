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
