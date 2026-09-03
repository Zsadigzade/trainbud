import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import type { HttpMcpServer } from "../src/httpServer.js";

/**
 * Every /mcp request builds its own MCP server and StreamableHTTP transport and
 * relies on the response's `close` event to release them. That listener used to
 * be attached in a `finally`, i.e. after the awaits -- so a client that hung up
 * mid-request had already emitted `close`, and `close` does not fire twice. The
 * handles stayed alive for the life of the process.
 *
 * The first attempt at this test counted process-level listeners and passed
 * against the deliberately broken build, which makes it worthless: a leak had
 * no observable at all. `liveMcpSessionCount()` is that observable, and it is
 * worth having outside the test too -- a count that climbs and never settles is
 * the fault, visible to an operator rather than only to a heap profiler.
 */
describe("an aborted MCP request must not leak its transport", () => {
  const originalEnv = {
    email: process.env.GARMIN_EMAIL,
    password: process.env.GARMIN_PASSWORD,
    apiKey: process.env.TRAINBUD_API_KEY,
    port: process.env.TRAINBUD_PORT,
    host: process.env.TRAINBUD_HOST,
  };

  let server: HttpMcpServer;
  const port = 3853;

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

  it("releases the transport of every request the client abandoned", async () => {
    const { liveMcpSessionCount } = await import("../src/httpServer.js");

    assert.equal(liveMcpSessionCount(), 0, "nothing should be in flight before the test");

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await abortMidRequest(port);
    }
    await settle();

    assert.equal(
      liveMcpSessionCount(),
      0,
      "an aborted request must release its MCP server and transport"
    );
  });

  it("releases the transport of a request that completed normally", async () => {
    const { liveMcpSessionCount } = await import("../src/httpServer.js");

    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-api-key-123",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    await response.arrayBuffer();
    await settle();

    assert.equal(liveMcpSessionCount(), 0);
  });
});

/**
 * Announce a body, send part of it, then destroy the socket. The server is
 * awaiting the rest of the body when the response dies, which is exactly the
 * window where the old `finally` registration was too late.
 */
function abortMidRequest(port: number): Promise<void> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(
        "POST /mcp HTTP/1.1\r\n" +
          "Host: 127.0.0.1\r\n" +
          "Authorization: Bearer test-api-key-123\r\n" +
          "Content-Type: application/json\r\n" +
          "Accept: application/json, text/event-stream\r\n" +
          "Content-Length: 400\r\n\r\n" +
          '{"jsonrpc":"2.0","id":1,"method":"init'
      );
      setTimeout(() => {
        socket.destroy();
        resolve();
      }, 25);
    });
    socket.on("error", () => resolve());
  });
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150));
}
