import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The cooldown now lives in the settings table, so the database path has to be
// redirected before anything imports appDb -- it is derived at module load.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-client-"));
process.env["GARMIN_CACHE_PATH"] = path.join(tmpDir, "cache.db");

const { getGarminClient, resetGarminClient } = await import("../src/garmin/client.js");
const { closeAppDb } = await import("../src/appDb.js");
import type { GarminConnectInstance } from "../src/garmin/garminConnect.js";

const fakeClient = { tag: "client" } as unknown as GarminConnectInstance;

describe("garmin client singleton", () => {
  beforeEach(() => {
    resetGarminClient();
  });

  after(() => {
    closeAppDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not cache a failed authentication forever", async () => {
    let calls = 0;
    const authenticator = async (): Promise<GarminConnectInstance> => {
      calls += 1;
      if (calls === 1) {
        throw new Error("Garmin authentication failed: bad password");
      }
      return fakeClient;
    };

    // The in-flight promise was memoised before it settled, so a rejection was
    // memoised too: every later call re-awaited the same rejected promise and
    // failed with the original error, even after the credentials were fixed.
    // Only a process restart cleared it.
    await assert.rejects(() => getGarminClient(false, authenticator));

    const client = await getGarminClient(false, authenticator);
    assert.equal(client, fakeClient);
    assert.equal(calls, 2);
  });

  it("stops retrying a login the upstream has rate limited", async () => {
    let calls = 0;
    const authenticator = async (): Promise<GarminConnectInstance> => {
      calls += 1;
      throw new Error("(429), Too Many Requests, error 1015: You are being rate limited");
    };

    // Garmin's SSO sits behind Cloudflare, which answers a burst of logins with
    // a 429 telling you to wait thirty seconds. The failed in-flight promise is
    // cleared on purpose so a corrected password does not need a restart, and
    // the consequence was that every later caller started its own fresh login.
    // `trainbud check` walks nine tools in sequence, so one expired session
    // became nine logins into a rate limit in about five seconds -- each one
    // deepening it. The command that exists to diagnose the problem was causing
    // it.
    await assert.rejects(() => getGarminClient(false, authenticator));
    await assert.rejects(() => getGarminClient(false, authenticator));
    await assert.rejects(() => getGarminClient(false, authenticator));

    assert.equal(calls, 1, "a rate-limited login was retried into the rate limit");
  });

  it("says how long the cooldown has left rather than repeating the upstream error", async () => {
    const authenticator = async (): Promise<GarminConnectInstance> => {
      throw new Error("(429), Too Many Requests, rate limited");
    };

    await assert.rejects(() => getGarminClient(false, authenticator));
    await assert.rejects(
      () => getGarminClient(false, authenticator),
      /rate limiting sign-in\. \d+s left to wait/
    );
  });

  it("keeps serving an existing session while sign-in is cooling down", async () => {
    let calls = 0;
    const authenticator = async (): Promise<GarminConnectInstance> => {
      calls += 1;
      if (calls === 1) {
        return fakeClient;
      }
      throw new Error("(429), Too Many Requests, rate limited");
    };

    assert.equal(await getGarminClient(false, authenticator), fakeClient);

    // A forced re-auth trips the cooldown, but the session already in hand is
    // still perfectly good: the cooldown is about signing in, not about the API.
    await assert.rejects(() => getGarminClient(true, authenticator));
    assert.equal(await getGarminClient(false, authenticator), fakeClient);
  });

  // The cooldown was a module variable, so it protected one long-lived `serve`
  // and nothing else: every `trainbud backfill` is a fresh process that started
  // with no memory of the limit and attempted another login. Running the command
  // again is the first thing a user does when it fails, and it was the exact
  // behaviour keeping Garmin's block alive.
  it("remembers the cooldown across processes", async () => {
    const authenticator = async (): Promise<GarminConnectInstance> => {
      throw new Error("(429), Too Many Requests, rate limited");
    };

    await assert.rejects(() => getGarminClient(false, authenticator));

    // Simulate a brand-new process: in-memory state gone, database kept.
    const { getSetting } = await import("../src/appDb.js");
    assert.ok(
      getSetting("garmin_auth_blocked_until"),
      "the cooldown was not written anywhere a second process could find it"
    );
  });

  it("doubles the wait each time the limit is hit again", async () => {
    const authenticator = async (): Promise<GarminConnectInstance> => {
      throw new Error("(429), Too Many Requests, rate limited");
    };
    const { getSetting, setSetting } = await import("../src/appDb.js");

    await assert.rejects(() => getGarminClient(false, authenticator));
    const first = Number(getSetting("garmin_auth_backoff_seconds"));

    // Let the window lapse, then get refused again.
    setSetting("garmin_auth_blocked_until", String(Date.now() - 1000));
    await assert.rejects(() => getGarminClient(false, authenticator));
    const second = Number(getSetting("garmin_auth_backoff_seconds"));

    assert.equal(second, first * 2, "the upstream asks for exponential backoff");
  });

  it("still shares one authentication across concurrent callers", async () => {
    let calls = 0;
    const authenticator = async (): Promise<GarminConnectInstance> => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return fakeClient;
    };

    const [a, b, c] = await Promise.all([
      getGarminClient(false, authenticator),
      getGarminClient(false, authenticator),
      getGarminClient(false, authenticator),
    ]);

    assert.equal(calls, 1, "three concurrent callers triggered more than one login");
    assert.equal(a, fakeClient);
    assert.equal(b, fakeClient);
    assert.equal(c, fakeClient);
  });
});
