import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HttpMcpServer } from "../src/httpServer.js";

// This file drives the real HTTP server, and /api/profile WRITES. The existing
// httpServer.test.ts never redirects the cache path, so anything it stores
// lands in the developer's own .trainbud/app.db -- the same class of mistake as
// the cooldown test that wrote a live five-minute Garmin block into it on every
// run. The redirect happens before any import that resolves the path, which is
// at module scope because appDb computes DB_PATH once.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-profile-api-"));
process.env.TRAINBUD_CACHE_PATH = path.join(dir, "cache.db");

describe("profile and usage API", () => {
  const originalEnv = {
    email: process.env.GARMIN_EMAIL,
    password: process.env.GARMIN_PASSWORD,
    apiKey: process.env.TRAINBUD_API_KEY,
    port: process.env.TRAINBUD_PORT,
    host: process.env.TRAINBUD_HOST,
  };

  let server: HttpMcpServer;
  const baseUrl = "http://127.0.0.1:3849";
  const token = "test-api-key-profile";
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  before(async () => {
    process.env.GARMIN_EMAIL = process.env.GARMIN_EMAIL ?? "test@example.com";
    process.env.GARMIN_PASSWORD = process.env.GARMIN_PASSWORD ?? "test-password";
    process.env.TRAINBUD_API_KEY = token;
    process.env.TRAINBUD_PORT = "3849";
    process.env.TRAINBUD_HOST = "127.0.0.1";

    const { createHttpMcpServer } = await import("../src/httpServer.js");
    server = createHttpMcpServer();
    await server.start();
  });

  after(async () => {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });

    process.env.GARMIN_EMAIL = originalEnv.email;
    process.env.GARMIN_PASSWORD = originalEnv.password;
    process.env.TRAINBUD_API_KEY = originalEnv.apiKey;
    process.env.TRAINBUD_PORT = originalEnv.port;
    process.env.TRAINBUD_HOST = originalEnv.host;
    delete process.env.TRAINBUD_CACHE_PATH;
  });

  it("refuses to hand out the profile without a token", async () => {
    // The profile carries a name, a sport and a race date. It is reachable over
    // the same public tunnel as everything else here.
    const response = await fetch(`${baseUrl}/api/profile`);
    assert.equal(response.status, 401);
  });

  it("refuses to change the profile without a token", async () => {
    const response = await fetch(`${baseUrl}/api/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "intruder" }),
    });
    assert.equal(response.status, 401);
  });

  it("returns the profile, the card catalogue and the defaults", async () => {
    const response = await fetch(`${baseUrl}/api/profile`, { headers: auth });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      profile: { units: string };
      cards: string[];
      defaults: { units: string };
    };
    assert.equal(body.profile.units, "metric");
    assert.ok(body.cards.includes("today"));
    assert.equal(body.defaults.units, "metric");
  });

  it("applies a partial update and reads it back", async () => {
    const put = await fetch(`${baseUrl}/api/profile`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ displayName: "Ziya", units: "imperial" }),
    });
    assert.equal(put.status, 200);

    const get = await fetch(`${baseUrl}/api/profile`, { headers: auth });
    const body = (await get.json()) as { profile: { displayName: string; units: string } };
    assert.equal(body.profile.displayName, "Ziya");
    assert.equal(body.profile.units, "imperial");
  });

  it("rejects an invalid value with 400 and names the field", async () => {
    // A form that colours every input red because one of them is wrong is a
    // form the user has to bisect by hand.
    const response = await fetch(`${baseUrl}/api/profile`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ thresholds: { recovery: { good: 10, caution: 90 } } }),
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { message: string };
    assert.match(body.message, /recovery/i);
  });

  it("rejects a body that is not an object", async () => {
    const response = await fetch(`${baseUrl}/api/profile`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify("nope"),
    });
    assert.equal(response.status, 400);
  });

  it("refuses a method it does not implement", async () => {
    const response = await fetch(`${baseUrl}/api/profile`, {
      method: "DELETE",
      headers: auth,
    });
    assert.equal(response.status, 405);
  });

  it("refuses usage without a token", async () => {
    const response = await fetch(`${baseUrl}/api/usage`);
    assert.equal(response.status, 401);
  });

  it("reports spend, budget and a full run of days", async () => {
    const response = await fetch(`${baseUrl}/api/usage`, { headers: auth });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      month: { calls: number; costUsd: number; unpricedCalls: number };
      budget: { capUsd: number | null; exceeded: boolean };
      daily: { day: string; costUsd: number }[];
      features: unknown[];
      recent: unknown[];
    };

    assert.equal(body.month.calls, 0);
    assert.equal(body.budget.capUsd, null);
    assert.equal(body.budget.exceeded, false);
    // Thirty days including the ones that cost nothing. A chart built only from
    // rows that exist draws a line through days the user never opened the app.
    assert.equal(body.daily.length, 30);
    assert.ok(Array.isArray(body.features));
    assert.ok(Array.isArray(body.recent));
  });
});
