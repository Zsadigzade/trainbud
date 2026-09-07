import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { HttpMcpServer } from "../src/httpServer.js";

/**
 * 0.5.1 shipped with none of these headers at all, while the server was
 * reachable from the internet for as long as the watch's tunnel stayed up. The
 * fix applies them before routing, which is the right place and also the easy
 * place to lose: any future early return that answers before that call --
 * a health probe, a redirect, a 404 -- silently drops them, and nothing fails.
 *
 * Nothing tested this. The property was verified once, by hand. So the fix has
 * exactly the shape that regressed in the first place, and this is the guard
 * that was missing: every class of response, including the ones written by
 * error paths, has to carry them.
 */
describe("every response carries the security headers, not just the happy path", () => {
  const originalEnv = {
    email: process.env.GARMIN_EMAIL,
    password: process.env.GARMIN_PASSWORD,
    apiKey: process.env.TRAINBUD_API_KEY,
    port: process.env.TRAINBUD_PORT,
    host: process.env.TRAINBUD_HOST,
  };

  let server: HttpMcpServer;
  const port = 3884;
  const base = `http://127.0.0.1:${port}`;

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

  // The public 200, the credentialed 401 and the routing 404 are three
  // different writers; the 401 is the one that matters most, because it is what
  // an unauthenticated scanner on the tunnel actually receives.
  const paths = ["/health", "/mcp", "/does-not-exist", "/dashboard"];

  it("sets them on every path, whatever the status", async () => {
    for (const path of paths) {
      const response = await fetch(`${base}${path}`);
      const headers = response.headers;

      assert.match(
        headers.get("content-security-policy") ?? "",
        /frame-ancestors 'none'/,
        `${path} (${response.status}) lost its CSP`
      );
      assert.equal(headers.get("x-content-type-options"), "nosniff", path);
      assert.equal(headers.get("x-frame-options"), "DENY", path);
      assert.equal(headers.get("referrer-policy"), "no-referrer", path);
    }
  });

  it("keeps the CSP free of an external script or style origin", async () => {
    const csp = (await fetch(`${base}/health`)).headers.get("content-security-policy") ?? "";

    assert.match(csp, /default-src 'self'/);
    assert.doesNotMatch(csp, /https?:\/\//, "no remote origin belongs in this policy");
  });

  it("does not send HSTS over plain http, which would lock out the loopback dashboard", async () => {
    // Documented behaviour: HSTS is for the TLS listener only. Sending it here
    // would pin http://127.0.0.1 to https in the browser and make the local
    // dashboard unreachable.
    const response = await fetch(`${base}/health`);

    assert.equal(response.headers.get("strict-transport-security"), null);
  });
});
