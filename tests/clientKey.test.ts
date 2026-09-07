import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { getClientKey } from "../src/httpServer.js";

/**
 * This function decides who a rate-limit budget belongs to, and the budget it
 * guards is the one on pairing -- the only flow reachable with no credential,
 * where guessing a six-digit code hands over the API key. Get the identity
 * wrong and an attacker rotating a header gets a fresh 30 requests a minute
 * each time, which turns a space you cannot walk in weeks into one you can.
 *
 * Two rules carry that weight, and neither was covered by a test:
 *
 *   1. `X-Forwarded-For` is trusted only when the socket is loopback, i.e. the
 *      request came from a tunnel agent on this machine. A direct caller cannot
 *      promote itself by inventing the header.
 *   2. The *last* hop is used, not the first, because a client may send its own
 *      header and the proxy appends the address it actually saw.
 *
 * Both are one refactor away from silently inverting.
 */
function request(remoteAddress: string | undefined, forwarded?: string | string[]): IncomingMessage {
  return {
    socket: { remoteAddress },
    headers: forwarded === undefined ? {} : { "x-forwarded-for": forwarded },
  } as unknown as IncomingMessage;
}

describe("who a rate-limit budget belongs to", () => {
  it("ignores a forwarded header from a caller that is not loopback", () => {
    // The attack: a direct caller claims to be someone else to get a new budget.
    const key = getClientKey(request("203.0.113.9", "198.51.100.7"));

    assert.equal(key, "203.0.113.9");
  });

  it("gives every spoofing attempt from one address the same budget", () => {
    const first = getClientKey(request("203.0.113.9", "10.0.0.1"));
    const second = getClientKey(request("203.0.113.9", "10.0.0.2"));

    assert.equal(first, second, "rotating the header must not buy a fresh budget");
  });

  it("takes the last hop from a tunnel agent, not the client's own claim", () => {
    // ngrok appends the address it saw, so the client's injected value is first
    // and the real one is last.
    const key = getClientKey(request("127.0.0.1", "1.2.3.4, 203.0.113.9"));

    assert.equal(key, "203.0.113.9");
  });

  it("treats an ipv6-mapped loopback address as loopback", () => {
    const key = getClientKey(request("::ffff:127.0.0.1", "203.0.113.9"));

    assert.equal(key, "203.0.113.9");
  });

  it("accepts the header repeated as an array", () => {
    const key = getClientKey(request("127.0.0.1", ["1.2.3.4", "203.0.113.9"]));

    assert.equal(key, "203.0.113.9");
  });

  it("falls back to the socket when the header carries nothing usable", () => {
    for (const forwarded of ["", "   ", ",", " , "]) {
      assert.equal(getClientKey(request("127.0.0.1", forwarded)), "127.0.0.1", forwarded);
    }
  });

  it("still returns a key when the socket has no address at all", () => {
    // A destroyed socket reports undefined. Returning undefined here would key
    // the whole map under one bucket by accident.
    assert.equal(getClientKey(request(undefined)), "unknown");
  });
});
