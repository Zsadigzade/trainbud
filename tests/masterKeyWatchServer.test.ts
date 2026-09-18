import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { HttpMcpServer } from "../src/httpServer.js";

// masterKeyWatch.test.ts pins the record itself. This pins the wiring: that the
// server notices the master key arriving on a watch route and writes it down,
// and -- just as important -- that nothing else produces the same record. A
// warning that fires for the dashboard or for an MCP client would be noise, and
// the whole point is that the reader can trust it names a real watch.
describe("recording a watch that syncs on the master key", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-masterkey-http-"));
  const originalEnv = {
    email: process.env.GARMIN_EMAIL,
    password: process.env.GARMIN_PASSWORD,
    apiKey: process.env.TRAINBUD_API_KEY,
    port: process.env.TRAINBUD_PORT,
    host: process.env.TRAINBUD_HOST,
    cachePath: process.env.TRAINBUD_CACHE_PATH,
  };

  const apiKey = "test-master-key-abcdef";
  const baseUrl = "http://127.0.0.1:3855";
  let server: HttpMcpServer;
  let appDb: typeof import("../src/appDb.js");

  before(async () => {
    process.env.GARMIN_EMAIL = process.env.GARMIN_EMAIL ?? "test@example.com";
    process.env.GARMIN_PASSWORD = process.env.GARMIN_PASSWORD ?? "test-password";
    process.env.TRAINBUD_API_KEY = apiKey;
    process.env.TRAINBUD_PORT = "3855";
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
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // See securityHeaders.test.ts: a held Windows handle is not a failure.
    }
  });

  it("writes down a /api/watch request made with the master key", async () => {
    appDb.clearMasterKeyWatch();

    const response = await fetch(`${baseUrl}/api/watch?card=today&build=2.1.0`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    // The summary needs Garmin and there is none here; what matters is that the
    // request authenticated, which any status other than 401 establishes.
    assert.notEqual(response.status, 401);

    const seen = appDb.getMasterKeyWatch();
    assert.notEqual(seen, null);
    assert.equal(seen?.build, "2.1.0");
    assert.equal(appDb.isMasterKeyWatchActive(), true);
  });

  it("writes nothing when the watch carries a token of its own", async () => {
    appDb.clearMasterKeyWatch();
    const { token } = appDb.createDeviceToken("watch-properly-paired");

    const response = await fetch(`${baseUrl}/api/watch?card=today&build=2.1.0`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.notEqual(response.status, 401);

    // This is the case the warning must stay silent for: the watch is paired,
    // revocable, and nothing is wrong.
    assert.equal(appDb.getMasterKeyWatch(), null);
  });

  it("writes nothing when the master key is used somewhere a watch never goes", async () => {
    appDb.clearMasterKeyWatch();

    // /mcp is the connector's route. The master key belongs there, and treating
    // it as a watch sighting would mean claude.ai raised a warning about a
    // watch that does not exist.
    await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

    assert.equal(appDb.getMasterKeyWatch(), null);
  });

  it("writes nothing when the request never authenticated", async () => {
    appDb.clearMasterKeyWatch();

    const response = await fetch(`${baseUrl}/api/watch?build=9.9.9`, {
      headers: { Authorization: "Bearer not-the-key" },
    });
    assert.equal(response.status, 401);

    // A record written before the auth check is a record anyone on the tunnel
    // can plant, and this one is read as evidence about the user's own watch.
    assert.equal(appDb.getMasterKeyWatch(), null);
  });

  it("records a mute from the wrist without losing the build", async () => {
    appDb.clearMasterKeyWatch();
    appDb.recordMasterKeyWatch("2.1.0", Math.floor(Date.now() / 1000) - 3600);

    await fetch(`${baseUrl}/api/mute`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "resting_hr_up" }),
    });

    const seen = appDb.getMasterKeyWatch();
    // /api/mute sends no build. The sighting moves forward; the version it
    // already knew stays.
    assert.equal(seen?.build, "2.1.0");
    assert.ok((seen?.last_seen_at ?? 0) > Math.floor(Date.now() / 1000) - 120);
  });
});
