import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getGarminClient, resetGarminClient } from "../src/garmin/client.js";
import type { GarminConnectInstance } from "../src/garmin/garminConnect.js";

const fakeClient = { tag: "client" } as unknown as GarminConnectInstance;

describe("garmin client singleton", () => {
  beforeEach(() => {
    resetGarminClient();
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
