import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { HttpMcpServer } from "../src/httpServer.js";

// The server is reachable from the public internet for as long as the tunnel
// the watch needs is up, and it shipped 0.5.1 with no security headers at all.
// These assert the headers exist on an unauthenticated response and on a 401,
// because a header set inside a route handler is a header the error paths miss.
describe("security headers and device token auth", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-headers-"));
  const originalEnv = {
    email: process.env.GARMIN_EMAIL,
    password: process.env.GARMIN_PASSWORD,
    apiKey: process.env.TRAINBUD_API_KEY,
    port: process.env.TRAINBUD_PORT,
    host: process.env.TRAINBUD_HOST,
    cachePath: process.env.TRAINBUD_CACHE_PATH,
  };

  let server: HttpMcpServer;
  let appDb: typeof import("../src/appDb.js");
  const baseUrl = "http://127.0.0.1:3854";

  before(async () => {
    process.env.GARMIN_EMAIL = process.env.GARMIN_EMAIL ?? "test@example.com";
    process.env.GARMIN_PASSWORD = process.env.GARMIN_PASSWORD ?? "test-password";
    process.env.TRAINBUD_API_KEY = "test-api-key-123";
    process.env.TRAINBUD_PORT = "3854";
    process.env.TRAINBUD_HOST = "127.0.0.1";
    process.env.TRAINBUD_CACHE_PATH = path.join(tempDir, "cache.db");

    appDb = await import("../src/appDb.js");
    const { createHttpMcpServer } = await import("../src/httpServer.js");
    server = createHttpMcpServer();
    await server.start();
  });

  after(async () => {
    await server.close();
    appDb.closeAppDb();

    process.env.GARMIN_EMAIL = originalEnv.email;
    process.env.GARMIN_PASSWORD = originalEnv.password;
    process.env.TRAINBUD_API_KEY = originalEnv.apiKey;
    process.env.TRAINBUD_PORT = originalEnv.port;
    process.env.TRAINBUD_HOST = originalEnv.host;
    if (originalEnv.cachePath === undefined) {
      delete process.env.TRAINBUD_CACHE_PATH;
    } else {
      process.env.TRAINBUD_CACHE_PATH = originalEnv.cachePath;
    }
    // Best effort. The server opens the cache and history databases in this
    // directory too, and on Windows a handle another module still holds turns
    // this into EPERM -- which would fail a suite whose tests all passed.
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // A directory left in the system temp folder is not a test failure.
    }
  });

  it("sets them on an unauthenticated response", async () => {
    const response = await fetch(`${baseUrl}/health`);

    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    assert.match(response.headers.get("content-security-policy") ?? "", /form-action 'self'/);
  });

  it("sets them on a 401, where a route-level header would be missed", async () => {
    const response = await fetch(`${baseUrl}/api/watch`);

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  });

  it("does not pin HSTS on a request that did not arrive over TLS", async () => {
    // Sending it on the loopback dashboard would pin https on a host the user
    // reaches over plain http, and lock them out of their own machine.
    const plain = await fetch(`${baseUrl}/health`);
    assert.equal(plain.headers.get("strict-transport-security"), null);

    const forwarded = await fetch(`${baseUrl}/health`, {
      headers: { "x-forwarded-proto": "https" },
    });
    assert.match(forwarded.headers.get("strict-transport-security") ?? "", /max-age=\d+/);
  });

  it("accepts a device token on the watch route", async () => {
    const { token } = appDb.createDeviceToken("watch-http-test");

    const response = await fetch(`${baseUrl}/api/watch`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Anything but 401 proves the credential was accepted; the payload itself
    // needs a Garmin session this test does not have.
    assert.notEqual(response.status, 401);
  });

  it("stops accepting it once the device is revoked", async () => {
    const device = appDb.createDeviceToken("watch-revoked");
    assert.equal(appDb.revokeDeviceToken(device.id), true);

    const response = await fetch(`${baseUrl}/api/watch`, {
      headers: { Authorization: `Bearer ${device.token}` },
    });

    assert.equal(response.status, 401);
  });

  it("still accepts the master key, so a watch paired before 0.5.2 keeps working", async () => {
    const response = await fetch(`${baseUrl}/api/watch`, {
      headers: { Authorization: "Bearer test-api-key-123" },
    });

    assert.notEqual(response.status, 401);
  });

  it("refuses a token that merely looks like one", async () => {
    const response = await fetch(`${baseUrl}/api/watch`, {
      headers: { Authorization: `Bearer tbd_${"0".repeat(64)}` },
    });

    assert.equal(response.status, 401);
  });
});
