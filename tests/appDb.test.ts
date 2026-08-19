import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { generatePairCode } from "../src/appDb.js";

// A pair code is the only thing standing between a stranger on the tunnel and
// the API key that /api/pair/<code>/status hands out once the code is approved.
// /api/pair is unauthenticated by design, so anyone can mint codes at will --
// which is exactly the sampling an attacker needs to recover the state of a
// non-cryptographic PRNG and predict the code the real watch is showing.
describe("pair code generation", () => {
  const originalRandom = Math.random;

  before(() => {
    // Math.random() is the wrong source here. Pinning it proves the codes do
    // not come from it: with a constant stub, a Math.random()-based generator
    // returns the same code every time.
    Math.random = () => 0.4242;
  });

  after(() => {
    Math.random = originalRandom;
  });

  it("does not draw from Math.random", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) {
      codes.add(generatePairCode());
    }
    assert.ok(codes.size > 1, "every code was identical — the generator is using Math.random");
  });

  it("is six digits", () => {
    for (let i = 0; i < 100; i++) {
      assert.match(generatePairCode(), /^\d{6}$/);
    }
  });

  it("covers the whole code space, including leading zeros", () => {
    // A generator that builds a number and stringifies it drops leading zeros
    // and yields short codes; one that skews away from 0 shrinks the space.
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      seen.add(generatePairCode());
    }
    assert.ok(seen.size > 4000, `only ${seen.size} distinct codes in 5000 draws`);
  });
});
