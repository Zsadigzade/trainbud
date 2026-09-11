import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  backoffMs,
  credentialFingerprint,
  describeWait,
  nextCooldownState,
  remainingCooldownMs,
  type AuthCooldownState,
} from "../src/garmin/authCooldown.js";

// The pure half of the sign-in backoff, tested without touching the disk. The
// persistence half is three lines of fs and is exercised through the same file
// helpers every other stored file in this project uses.
//
// What is worth pinning here is the behaviour that makes this a fix rather than
// an obstacle: correcting the password has to clear the wait, and the first
// failure has to be cheap.

describe("sign-in backoff schedule", () => {
  it("costs nothing before the first failure", () => {
    assert.equal(backoffMs(0), 0);
    assert.equal(backoffMs(-1), 0);
  });

  it("starts at half a minute, so a network blip is not a punishment", () => {
    assert.equal(backoffMs(1), 30_000);
  });

  it("escalates, because repetition is the evidence a single failure is not", () => {
    const schedule = [1, 2, 3, 4, 5].map(backoffMs);
    assert.deepEqual(schedule, [30_000, 60_000, 120_000, 240_000, 480_000]);

    for (let i = 1; i < schedule.length; i++) {
      assert.ok(
        (schedule[i] ?? 0) > (schedule[i - 1] ?? 0),
        `step ${i} must be longer than the one before it`
      );
    }
  });

  it("caps, so a forgotten wrong password does not become an hour", () => {
    assert.equal(backoffMs(6), 900_000);
    assert.equal(backoffMs(50), 900_000);
    assert.equal(backoffMs(5000), 900_000);
  });
});

describe("credential fingerprint", () => {
  it("is stable for the same credentials", () => {
    assert.equal(
      credentialFingerprint("a@b.com", "hunter2"),
      credentialFingerprint("a@b.com", "hunter2")
    );
  });

  it("changes when either half changes", () => {
    const base = credentialFingerprint("a@b.com", "hunter2");
    assert.notEqual(base, credentialFingerprint("a@b.com", "hunter3"));
    assert.notEqual(base, credentialFingerprint("c@d.com", "hunter2"));
  });

  it("does not confuse a shifted boundary between the two fields", () => {
    // Without a separator, ("ab", "c") and ("a", "bc") hash identically, and a
    // password change could silently inherit another one's failure count.
    assert.notEqual(credentialFingerprint("ab", "c"), credentialFingerprint("a", "bc"));
  });

  it("does not contain the password", () => {
    const hash = credentialFingerprint("a@b.com", "hunter2");
    assert.ok(!hash.includes("hunter2"));
    assert.match(hash, /^[0-9a-f]{64}$/);
  });
});

describe("remaining cooldown", () => {
  const fingerprint = credentialFingerprint("a@b.com", "wrong");

  function state(overrides: Partial<AuthCooldownState> = {}): AuthCooldownState {
    return {
      credentialHash: fingerprint,
      failures: 3,
      blockedUntil: 10_000,
      ...overrides,
    };
  }

  it("is zero when nothing has failed yet", () => {
    assert.equal(remainingCooldownMs(null, fingerprint, 0), 0);
  });

  it("reports the time left while blocked", () => {
    assert.equal(remainingCooldownMs(state(), fingerprint, 4_000), 6_000);
  });

  it("is zero once the block has elapsed", () => {
    assert.equal(remainingCooldownMs(state(), fingerprint, 10_000), 0);
    assert.equal(remainingCooldownMs(state(), fingerprint, 99_000), 0);
  });

  it("does not apply to credentials that did not fail", () => {
    // This is the whole design. Fixing the password in .env has to work
    // immediately; a safety feature whose fix is "now wait fifteen minutes" is
    // one people turn off.
    const corrected = credentialFingerprint("a@b.com", "right");
    assert.equal(remainingCooldownMs(state(), corrected, 0), 0);
  });
});

describe("next cooldown state", () => {
  const wrong = credentialFingerprint("a@b.com", "wrong");

  it("records the first failure", () => {
    const next = nextCooldownState(null, wrong, 1_000, "401 Unauthorized");
    assert.equal(next.failures, 1);
    assert.equal(next.credentialHash, wrong);
    assert.equal(next.blockedUntil, 1_000 + 30_000);
    assert.equal(next.lastError, "401 Unauthorized");
  });

  it("accumulates failures for the same credentials", () => {
    let state = nextCooldownState(null, wrong, 0, "nope");
    state = nextCooldownState(state, wrong, 0, "nope");
    state = nextCooldownState(state, wrong, 0, "nope");
    assert.equal(state.failures, 3);
    assert.equal(state.blockedUntil, 120_000);
  });

  it("starts over when the credentials change", () => {
    const accumulated = nextCooldownState(
      { credentialHash: wrong, failures: 9, blockedUntil: 0 },
      credentialFingerprint("a@b.com", "corrected"),
      0,
      "first try with the new password"
    );
    assert.equal(accumulated.failures, 1);
    assert.equal(accumulated.blockedUntil, 30_000);
  });
});

describe("wait description", () => {
  it("uses seconds when a person would", () => {
    assert.equal(describeWait(1_000), "1 second");
    assert.equal(describeWait(30_000), "30 seconds");
    assert.equal(describeWait(45_500), "46 seconds");
  });

  it("switches to minutes once seconds stop being useful", () => {
    assert.equal(describeWait(120_000), "2 minutes");
    assert.equal(describeWait(900_000), "15 minutes");
  });

  it("rounds up, so the stated wait is never short", () => {
    // A message that says "wait 1 minute" and then refuses at 61 seconds is
    // worse than no message.
    assert.equal(describeWait(90_001), "2 minutes");
  });
});
