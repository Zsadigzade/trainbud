import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEVICE_TOKEN_PREFIX,
  defaultDeviceLabel,
  generateDeviceToken,
  hashDeviceToken,
  looksLikeDeviceToken,
} from "../src/deviceTokens.js";

// appDb resolves its file from appConfig.cachePath at module load, so the
// pointer has to move before the module is imported. Everything DB-backed
// below therefore goes through a dynamic import inside `before`.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-devices-"));
const previousCachePath = process.env.TRAINBUD_CACHE_PATH;

describe("device token values", () => {
  it("carries the prefix and 32 bytes of hex", () => {
    const token = generateDeviceToken();
    assert.ok(token.startsWith(DEVICE_TOKEN_PREFIX));
    assert.equal(token.length, DEVICE_TOKEN_PREFIX.length + 64);
    assert.match(token.slice(DEVICE_TOKEN_PREFIX.length), /^[0-9a-f]{64}$/);
  });

  it("does not repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generateDeviceToken());
    assert.equal(seen.size, 500);
  });

  it("hashes deterministically, and the hash is not the token", () => {
    const token = generateDeviceToken();
    assert.equal(hashDeviceToken(token), hashDeviceToken(token));
    assert.notEqual(hashDeviceToken(token), token);
    assert.match(hashDeviceToken(token), /^[0-9a-f]{64}$/);
  });

  it("rejects shapes that are not device tokens", () => {
    assert.equal(looksLikeDeviceToken(generateDeviceToken()), true);
    assert.equal(looksLikeDeviceToken("not-a-token"), false);
    assert.equal(looksLikeDeviceToken(""), false);
    // A master key never looks like one, which is what keeps the dashboard off
    // the database lookup path.
    assert.equal(looksLikeDeviceToken("a".repeat(64)), false);
    // Right prefix, wrong length: still not a device token.
    assert.equal(looksLikeDeviceToken(`${DEVICE_TOKEN_PREFIX}abc`), false);
  });

  it("labels a device by the day it was paired", () => {
    assert.equal(defaultDeviceLabel(new Date("2026-09-06T21:15:00Z")), "watch-2026-09-06");
  });
});

describe("device token storage", () => {
  let appDb: typeof import("../src/appDb.js");

  before(async () => {
    process.env.TRAINBUD_CACHE_PATH = path.join(tempDir, "cache.db");
    appDb = await import("../src/appDb.js");
  });

  after(() => {
    appDb.closeAppDb();
    if (previousCachePath === undefined) {
      delete process.env.TRAINBUD_CACHE_PATH;
    } else {
      process.env.TRAINBUD_CACHE_PATH = previousCachePath;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Windows can still hold the database handle; see securityHeaders.test.ts.
    }
  });

  it("returns the plaintext once and stores only the hash", () => {
    const { id, token } = appDb.createDeviceToken("watch-test");

    const row = appDb
      .getAppDb()
      .prepare("SELECT token_hash FROM device_tokens WHERE id = ?")
      .get(id) as { token_hash: string };

    assert.equal(row.token_hash, hashDeviceToken(token));
    assert.notEqual(row.token_hash, token);

    // The plaintext must not survive anywhere in the row.
    const full = JSON.stringify(
      appDb.getAppDb().prepare("SELECT * FROM device_tokens WHERE id = ?").get(id)
    );
    assert.equal(full.includes(token), false);
  });

  it("resolves a token to its id, and refuses everything else", () => {
    const { id, token } = appDb.createDeviceToken("watch-resolve");

    assert.equal(appDb.findDeviceTokenId(token), id);
    assert.equal(appDb.findDeviceTokenId(generateDeviceToken()), null);
    assert.equal(appDb.findDeviceTokenId("garbage"), null);
    // One character off is a different token, not a near miss.
    assert.equal(appDb.findDeviceTokenId(token.slice(0, -1) + (token.endsWith("a") ? "b" : "a")), null);
  });

  it("revokes one device without touching the others", () => {
    const keep = appDb.createDeviceToken("watch-keep");
    const drop = appDb.createDeviceToken("watch-drop");

    assert.equal(appDb.revokeDeviceToken(drop.id), true);
    assert.equal(appDb.findDeviceTokenId(drop.token), null);
    assert.equal(appDb.findDeviceTokenId(keep.token), keep.id);

    // Revoking the same id twice is not a second success.
    assert.equal(appDb.revokeDeviceToken(drop.id), false);
  });

  it("lists devices newest first and reports them all revoked", () => {
    appDb.revokeAllDeviceTokens();
    appDb.createDeviceToken("watch-a");
    appDb.createDeviceToken("watch-b");

    const listed = appDb.listDeviceTokens();
    assert.equal(listed.length, 2);
    assert.ok(listed[0]!.created_at >= listed[1]!.created_at);
    assert.equal(listed[0]!.last_seen_at, null);

    assert.equal(appDb.revokeAllDeviceTokens(), 2);
    assert.deepEqual(appDb.listDeviceTokens(), []);
  });

  it("records last seen, then throttles further writes for a minute", () => {
    const { id } = appDb.createDeviceToken("watch-seen");
    const now = 1_800_000_000;

    appDb.touchDeviceToken(id, now);
    const first = appDb.listDeviceTokens().find((d) => d.id === id)!;
    assert.equal(first.last_seen_at, now);

    // A second poll thirty seconds later must not cost a write.
    appDb.touchDeviceToken(id, now + 30);
    const throttled = appDb.listDeviceTokens().find((d) => d.id === id)!;
    assert.equal(throttled.last_seen_at, now);

    appDb.touchDeviceToken(id, now + 61);
    const later = appDb.listDeviceTokens().find((d) => d.id === id)!;
    assert.equal(later.last_seen_at, now + 61);
  });

  it("hands a paired watch a device token, not the master key", async () => {
    const { checkPairStatus, approvePairing, requestPairing } = await import("../src/pairApi.js");
    const { appConfig } = await import("../src/config.js");

    const pairing = requestPairing();
    assert.equal(approvePairing(pairing.code), true);

    const status = checkPairStatus(pairing.code, "https://example.test");
    assert.equal(status?.approved, true);

    const issued = status!.api_key!;
    assert.equal(looksLikeDeviceToken(issued), true);
    assert.notEqual(issued, appConfig.mcpApiKey);
    assert.ok(appDb.findDeviceTokenId(issued) !== null);
  });
});
