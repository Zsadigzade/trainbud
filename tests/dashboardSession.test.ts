import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { HttpMcpServer } from "../src/httpServer.js";

/**
 * The dashboard used to authenticate with `?token=<the live API key>` for the
 * whole session, so the key sat in the address bar, in browser history, in the
 * tunnel's access log, and in every screenshot of the page. These tests pin the
 * trade: the token gets you in once, a cookie carries you after that, and the
 * URL the browser is left holding contains no key.
 */
describe("dashboard session cookie", () => {
  const originalEnv = {
    email: process.env.GARMIN_EMAIL,
    password: process.env.GARMIN_PASSWORD,
    apiKey: process.env.TRAINBUD_API_KEY,
    port: process.env.TRAINBUD_PORT,
    host: process.env.TRAINBUD_HOST,
  };

  const apiKey = "session-test-api-key";
  const baseUrl = "http://127.0.0.1:3853";
  let server: HttpMcpServer;
  let clearDashboardSessions: () => void;

  before(async () => {
    process.env.GARMIN_EMAIL = process.env.GARMIN_EMAIL ?? "test@example.com";
    process.env.GARMIN_PASSWORD = process.env.GARMIN_PASSWORD ?? "test-password";
    process.env.TRAINBUD_API_KEY = apiKey;
    process.env.TRAINBUD_PORT = "3853";
    process.env.TRAINBUD_HOST = "127.0.0.1";

    const mod = await import("../src/httpServer.js");
    clearDashboardSessions = mod.clearDashboardSessions;
    server = mod.createHttpMcpServer();
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

  /** The one cookie value the browser would send back. */
  function sessionFrom(response: Response): string {
    const header = response.headers.get("set-cookie");
    assert.ok(header, "expected a Set-Cookie header");
    const value = header.split(";")[0] ?? "";
    assert.ok(value.startsWith("tb_session="), `unexpected cookie: ${header}`);
    return value;
  }

  it("trades the token in the URL for a redirect to a URL without one", async () => {
    const response = await fetch(`${baseUrl}/dashboard?token=${apiKey}`, { redirect: "manual" });

    assert.equal(response.status, 302);
    // The whole point: what the browser is left showing carries no key.
    assert.equal(response.headers.get("location"), "/dashboard");
    assert.ok(!response.headers.get("location")?.includes(apiKey));
  });

  it("marks the cookie HttpOnly and SameSite=Lax", async () => {
    const response = await fetch(`${baseUrl}/dashboard?token=${apiKey}`, { redirect: "manual" });
    const header = response.headers.get("set-cookie") ?? "";

    // HttpOnly keeps page script from reading it; Lax is what stops a
    // cross-site POST from riding the cookie, which is the risk cookie auth
    // adds over a Bearer header.
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Lax/);
    assert.match(header, /Path=\//);
  });

  it("does not mark the cookie Secure over plain http, which would discard it", async () => {
    const response = await fetch(`${baseUrl}/dashboard?token=${apiKey}`, { redirect: "manual" });

    assert.doesNotMatch(response.headers.get("set-cookie") ?? "", /Secure/);
  });

  it("marks the cookie Secure when a proxy reports https", async () => {
    const response = await fetch(`${baseUrl}/dashboard?token=${apiKey}`, {
      redirect: "manual",
      headers: { "x-forwarded-proto": "https" },
    });

    assert.match(response.headers.get("set-cookie") ?? "", /Secure/);
  });

  it("never puts the API key in the cookie", async () => {
    const response = await fetch(`${baseUrl}/dashboard?token=${apiKey}`, { redirect: "manual" });

    assert.ok(!(response.headers.get("set-cookie") ?? "").includes(apiKey));
  });

  it("serves the page on the clean URL once the cookie is held", async () => {
    const first = await fetch(`${baseUrl}/dashboard?token=${apiKey}`, { redirect: "manual" });
    const cookie = sessionFrom(first);

    const second = await fetch(`${baseUrl}/dashboard`, { headers: { cookie } });

    assert.equal(second.status, 200);
    assert.match(second.headers.get("content-type") ?? "", /text\/html/);
  });

  it("authorises the JSON endpoints the page calls with no Authorization header", async () => {
    const first = await fetch(`${baseUrl}/dashboard?token=${apiKey}`, { redirect: "manual" });
    const cookie = sessionFrom(first);

    // The page's own fetch() sends the cookie and nothing else once the token
    // has left the URL, so these must pass on the cookie alone.
    const status = await fetch(`${baseUrl}/dashboard/status`, { headers: { cookie } });

    assert.equal(status.status, 200);
  });

  it("does not redirect a second time once the session exists", async () => {
    const first = await fetch(`${baseUrl}/dashboard?token=${apiKey}`, { redirect: "manual" });
    const cookie = sessionFrom(first);

    // A bookmarked ?token= URL must not mint a new session on every visit.
    const again = await fetch(`${baseUrl}/dashboard?token=${apiKey}`, {
      redirect: "manual",
      headers: { cookie },
    });

    assert.equal(again.status, 200);
    assert.equal(again.headers.get("set-cookie"), null);
  });

  it("still answers a Bearer header with the page and no cookie", async () => {
    const response = await fetch(`${baseUrl}/dashboard`, {
      redirect: "manual",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("set-cookie"), null);
  });

  it("refuses a forged session id", async () => {
    const response = await fetch(`${baseUrl}/dashboard`, {
      redirect: "manual",
      headers: { cookie: `tb_session=${"a".repeat(64)}` },
    });

    assert.equal(response.status, 401);
  });

  it("refuses a cookie the server no longer knows, as after a restart", async () => {
    const first = await fetch(`${baseUrl}/dashboard?token=${apiKey}`, { redirect: "manual" });
    const cookie = sessionFrom(first);

    clearDashboardSessions();

    const after = await fetch(`${baseUrl}/dashboard`, { redirect: "manual", headers: { cookie } });

    assert.equal(after.status, 401);
  });

  it("refuses a wrong token in the URL rather than issuing a session", async () => {
    const response = await fetch(`${baseUrl}/dashboard?token=not-the-key`, { redirect: "manual" });

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("set-cookie"), null);
  });
});
