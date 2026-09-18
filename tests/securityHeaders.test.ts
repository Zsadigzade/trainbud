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
  it("sets them on a 404, which no route handler ever sees", async () => {
    // The 401 above proves an error path keeps them. This proves the routing
    // miss does too: a 404 is written before any handler runs, so it is the
    // response most likely to escape a header applied per route.
    const response = await fetch(`${baseUrl}/does-not-exist`);

    assert.equal(response.status, 404);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  });

  it("keeps the policy free of any remote origin", async () => {
    // A remote host in the policy would be a page that can pull script or style
    // from off the machine.
    const csp = (await fetch(`${baseUrl}/health`)).headers.get("content-security-policy") ?? "";

    assert.match(csp, /default-src 'self'/);
    assert.doesNotMatch(csp, /https?:\/\//);
  });

  // 'unsafe-inline' on script-src was carried as documented debt on the grounds
  // that "the dashboard is server-rendered HTML with one inline script and
  // inline handlers, and a nonce-based policy is a rewrite of the page". Half of
  // that was not true: there is not one inline event handler in either page, so
  // the only thing the allowance ever covered was the single <script> block
  // each of them carries -- exactly what a nonce is for.
  describe("the script policy", () => {
    it("names a nonce and does not allow inline script", async () => {
      const csp = (await fetch(`${baseUrl}/health`)).headers.get("content-security-policy") ?? "";
      const scriptSrc = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src"));

      assert.ok(scriptSrc, `no script-src in "${csp}"`);
      assert.match(scriptSrc, /'nonce-[A-Za-z0-9+/=_-]{16,}'/);
      assert.doesNotMatch(scriptSrc, /'unsafe-inline'/);
      assert.doesNotMatch(scriptSrc, /'unsafe-eval'/);
    });

    it("issues a different nonce every response", async () => {
      // A nonce reused across responses is a constant an attacker can read off
      // one page and put in the next, which is the whole allowance back again.
      const read = async (): Promise<string> => {
        const csp = (await fetch(`${baseUrl}/health`)).headers.get("content-security-policy") ?? "";
        return /'nonce-([^']+)'/.exec(csp)?.[1] ?? "";
      };

      const seen = new Set<string>();
      for (let i = 0; i < 5; i += 1) seen.add(await read());

      assert.equal(seen.size, 5, `repeated a nonce: ${[...seen].join(", ")}`);
      assert.equal(seen.has(""), false, "a response carried no nonce");
    });

    it("keeps style-src permissive, and says so on purpose", async () => {
      // The pages carry inline style attributes, which a nonce cannot cover --
      // that needs 'unsafe-hashes' or moving every one into a class. script-src
      // is the half that matters for script injection and the half being fixed;
      // this pins the other half so the difference stays deliberate.
      const csp = (await fetch(`${baseUrl}/health`)).headers.get("content-security-policy") ?? "";
      const styleSrc = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("style-src"));

      assert.ok(styleSrc);
      assert.match(styleSrc, /'unsafe-inline'/);
    });

    it("gives the dashboard's own script tag the nonce from its response", async () => {
      // The header and the page have to agree or the dashboard simply stops
      // working, which is the failure mode a nonce introduces and the reason
      // this is asserted against the real response rather than the renderer.
      const response = await fetch(`${baseUrl}/dashboard?token=test-api-key-123`, {
        redirect: "manual",
      });
      const nonce = /'nonce-([^']+)'/.exec(response.headers.get("content-security-policy") ?? "")?.[1];
      assert.ok(nonce, "no nonce on the dashboard response");

      // ?token= answers a 302 and a cookie; follow it with the cookie to get
      // the page itself, and grade the page that a browser would actually run.
      const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
      const page = await fetch(`${baseUrl}/dashboard`, { headers: { cookie } });
      const pageNonce = /'nonce-([^']+)'/.exec(page.headers.get("content-security-policy") ?? "")?.[1];
      const html = await page.text();

      assert.ok(pageNonce, "no nonce on the dashboard page response");
      assert.ok(
        html.includes(`<script nonce="${pageNonce}">`),
        `the page's script tag does not carry its own response's nonce`
      );
      // And nothing else may: a second script without one is script the browser
      // will now refuse to run.
      assert.equal((html.match(/<script/g) ?? []).length, (html.match(/<script nonce="/g) ?? []).length);
    });
  });
});
