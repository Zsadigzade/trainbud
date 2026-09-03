import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GarminApiError } from "../src/garmin/types.js";
import type { GarminConnectInstance } from "../src/garmin/garminConnect.js";

// The cooldown lives in the settings table of `app.db`, whose path is resolved
// from `appConfig.cachePath` when the module is first imported. A static import
// here would therefore write a live five-minute Garmin block into the DEVELOPER'S
// OWN database every time the suite ran -- which is exactly what the first
// version of this file did, and it took the next `trainbud backfill` with it.
//
// The vault note for this project says the previous generation of tests reached
// real services and a real database and that both cost a debugging session.
// Redirect the path first, then import.
let client_: typeof import("../src/garmin/client.js");
let appDb_: typeof import("../src/appDb.js");
let directory: string;

before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-cooldown-"));
  process.env.TRAINBUD_CACHE_PATH = path.join(directory, "cache.db");
  client_ = await import("../src/garmin/client.js");
  appDb_ = await import("../src/appDb.js");
});

after(() => {
  // Windows will not unlink a file with an open handle, so the database has to
  // be closed before the directory can go.
  appDb_.closeAppDb();
  delete process.env.TRAINBUD_CACHE_PATH;
  fs.rmSync(directory, { recursive: true, force: true });
});

const getGarminClient = (...args: Parameters<typeof client_.getGarminClient>) =>
  client_.getGarminClient(...args);
const resetGarminClient = (): void => client_.resetGarminClient();
const resetGarminSession = (): void => client_.resetGarminSession();
const withGarminClient = <T>(...args: Parameters<typeof client_.withGarminClient<T>>) =>
  client_.withGarminClient(...args);

// The cooldown exists because `trainbud check` walked nine tools in sequence,
// turned one expired session into nine logins in five seconds, and deepened
// Garmin's rate limit with every one. It is persisted, and it doubles each time
// the limit is hit again, because Cloudflare's own 1015 body asks for
// exponential backoff.
//
// `withGarminClient` then did this on any auth-shaped failure:
//
//     resetGarminClient();          // -> clearCooldown()
//     const client = await getGarminClient(true);
//
// `resetGarminClient` deletes both cooldown keys. So the retry path -- the one
// reached by exactly the failure the cooldown is for -- erased it and attempted
// a fresh login into the live block. The backoff could never escalate past its
// 60-second floor, because every failure reset the ladder to the bottom rung.
//
// Two different jobs shared one function: "forget the session" and "forget the
// rate limit". `trainbud auth` wants both. The retry path wants only the first.

const client = {} as GarminConnectInstance;

function rateLimited(): never {
  throw new GarminApiError("Garmin rate limit reached.", 429, 300);
}

describe("the retry path does not erase the block it just hit", () => {
  beforeEach(() => {
    resetGarminClient();
  });

  it("keeps the cooldown when a login is rate limited", async () => {
    await assert.rejects(() => getGarminClient(true, rateLimited));

    // The next caller must be refused locally rather than sent at the upstream.
    await assert.rejects(
      () => getGarminClient(false, async () => client),
      /rate limiting sign-in/
    );
  });

  it("keeps the window the upstream asked for rather than dropping to the floor", async () => {
    // Cloudflare's 1015 body carried retry_after 300. Clearing the cooldown on
    // the retry path threw that away along with the backoff step, so the next
    // block started again at the 60-second minimum -- the ladder could never
    // escalate, however many times the limit was hit.
    await assert.rejects(() => getGarminClient(true, rateLimited));

    resetGarminSession();

    const remaining = await waitSeconds();
    assert.ok(
      remaining > 60,
      `${remaining}s left — the upstream asked for 300 and the ladder was reset to the floor`
    );
  });

  it("forgets the session without forgetting the limit", async () => {
    await assert.rejects(() => getGarminClient(true, rateLimited));

    resetGarminSession();

    await assert.rejects(
      () => getGarminClient(false, async () => client),
      /rate limiting sign-in/,
      "resetGarminSession must not clear the cooldown"
    );
  });

  it("still clears everything on an explicit reset, which is what `auth` wants", async () => {
    await assert.rejects(() => getGarminClient(true, rateLimited));

    resetGarminClient();

    const resolved = await getGarminClient(false, async () => client);
    assert.equal(resolved, client);
  });

  // The state the bug actually needs, and the reason the first version of this
  // test passed against the broken build: a LIVE SESSION AND A LIVE COOLDOWN
  // together.
  //
  // With no cached session, `getGarminClient(false)` sees the cooldown and
  // refuses before the retry path is ever entered -- so a test that starts
  // there exercises none of the changed code. But a cached session is returned
  // without consulting the cooldown at all (`if (clientInstance && !forceAuth)`
  // is the first line), so the request goes out, fails on a stale token, and
  // lands in the retry. That is where `resetGarminClient` erased the block and
  // logged straight back into it.
  it("does not log in again while a block is live, having reached the retry through a cached session", async () => {
    let logins = 0;
    const counting = async (): Promise<GarminConnectInstance> => {
      logins += 1;
      return client;
    };

    // A session, cached.
    assert.equal(await getGarminClient(false, counting), client);
    assert.equal(logins, 1);

    // A rate limit, recorded. The forced login throws, so the cached session
    // above survives -- exactly the real situation.
    await assert.rejects(() => getGarminClient(true, rateLimited));

    // A request that fails on a stale token.
    await assert.rejects(
      () =>
        withGarminClient(async () => {
          throw new Error("401 unauthorized");
        }, counting),
      /rate limiting sign-in/,
      "the retry path swallowed the block and reported the auth error instead"
    );

    assert.equal(logins, 1, "the retry attempted a fresh login while the block was live");
  });
});

/** Seconds left on the cooldown, read through the public refusal message. */
async function waitSeconds(): Promise<number> {
  try {
    await getGarminClient(false, async () => client);
  } catch (error) {
    const match = /(\d+)s left to wait/.exec(error instanceof Error ? error.message : "");
    if (match?.[1]) {
      return Number.parseInt(match[1], 10);
    }
  }
  throw new Error("expected a cooldown refusal carrying a wait");
}
