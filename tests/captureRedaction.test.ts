import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactPayload } from "../src/history/capture.js";

describe("payload redaction", () => {
  it("replaces the identifiers Connect attaches to every response", () => {
    const redacted = redactPayload({
      userProfilePK: 136705478,
      userProfileId: 999,
      displayName: "a-real-uuid",
      fullName: "Ziya Sadigzade",
      avgStressLevel: 34,
    }) as Record<string, unknown>;

    assert.equal(redacted.userProfilePK, "<redacted>");
    assert.equal(redacted.userProfileId, "<redacted>");
    assert.equal(redacted.displayName, "<redacted>");
    assert.equal(redacted.fullName, "<redacted>");
  });

  // The whole point of a captured fixture is the measurements. Redacting one
  // would make the fixture worse than the invented payload it replaces.
  it("leaves every measurement untouched", () => {
    const redacted = redactPayload({
      avgStressLevel: 34,
      maxStressLevel: 88,
      calendarDate: "2026-08-19",
      values: [1, 2, 3],
    }) as Record<string, unknown>;

    assert.equal(redacted.avgStressLevel, 34);
    assert.equal(redacted.maxStressLevel, 88);
    assert.equal(redacted.calendarDate, "2026-08-19");
    assert.deepEqual(redacted.values, [1, 2, 3]);
  });

  it("redacts anything that looks like a token or a key", () => {
    const redacted = redactPayload({
      accessToken: "secret",
      refreshToken: "secret",
      consumerKey: "secret",
      apiKey: "secret",
    }) as Record<string, unknown>;

    for (const value of Object.values(redacted)) {
      assert.equal(value, "<redacted>");
    }
  });

  it("recurses into nested objects and arrays", () => {
    const redacted = redactPayload({
      dailySleepDTO: { userProfilePK: 1, sleepTimeSeconds: 22680 },
      dateWeightList: [{ userId: 7, weight: 74.2 }],
    }) as { dailySleepDTO: Record<string, unknown>; dateWeightList: Record<string, unknown>[] };

    assert.equal(redacted.dailySleepDTO.userProfilePK, "<redacted>");
    assert.equal(redacted.dailySleepDTO.sleepTimeSeconds, 22680);
    assert.equal(redacted.dateWeightList[0]?.userId, "<redacted>");
    assert.equal(redacted.dateWeightList[0]?.weight, 74.2);
  });

  it("does not mutate its input", () => {
    const original = { userProfilePK: 136705478, avgStressLevel: 34 };
    redactPayload(original);

    assert.equal(original.userProfilePK, 136705478);
  });

  it("survives null, primitives and empty arrays", () => {
    assert.equal(redactPayload(null), null);
    assert.equal(redactPayload(42), 42);
    assert.equal(redactPayload("text"), "text");
    assert.deepEqual(redactPayload([]), []);
  });

  it("is case insensitive about the key name", () => {
    const redacted = redactPayload({ UserProfilePK: 1, USERID: 2 }) as Record<string, unknown>;

    assert.equal(redacted.UserProfilePK, "<redacted>");
    assert.equal(redacted.USERID, "<redacted>");
  });
});
