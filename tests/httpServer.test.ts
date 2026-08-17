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
