import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeNodeVersion } from "../src/check.js";

/**
 * `trainbud check` is what somebody runs when the thing will not work, and it
 * had nothing to say about the runtime it is running on.
 *
 * That is the failure people actually hit. `better-sqlite3` publishes no
 * prebuilt binary below Node 22, so an install on an older Node either compiles
 * from source or dies with a page of gyp errors about Visual Studio -- and if
 * a working install is later run under a different Node, the native module
 * refuses to load with an ABI message that names no fix. One line naming the
 * version and the floor turns either of those into an answer.
 */
describe("the check knows which Node it is running on", () => {
  it("passes on a version at or above the floor", () => {
    const result = describeNodeVersion("22.12.0", ">=22.12.0");

    assert.equal(result.ok, true);
    assert.equal(result.warning, false);
    assert.match(result.summary, /22\.12\.0/);
  });

  it("fails on a version below it, and says what to do", () => {
    const result = describeNodeVersion("20.20.2", ">=22.12.0");

    assert.equal(result.ok, false);
    assert.match(result.summary, /20\.20\.2/, "says what you are on");
    assert.match(result.summary, /22/, "says what is needed");
  });

  it("mentions the reason, because the failure it prevents is cryptic", () => {
    const result = describeNodeVersion("20.20.2", ">=22.12.0");

    assert.match(result.summary, /prebuilt|compile|source/i);
  });

  it("compares numerically rather than as text", () => {
    // "9.0.0" > "22.0.0" as strings, and a check that gets this wrong passes
    // exactly when it matters least.
    assert.equal(describeNodeVersion("9.0.0", ">=22.12.0").ok, false);
    assert.equal(describeNodeVersion("24.1.0", ">=22.12.0").ok, true);
    assert.equal(describeNodeVersion("22.11.0", ">=22.12.0").ok, false);
    assert.equal(describeNodeVersion("22.12.1", ">=22.12.0").ok, true);
  });

  it("does not fail the whole check when the requirement cannot be parsed", () => {
    const result = describeNodeVersion("22.12.0", "not a range");

    assert.equal(result.ok, true);
    assert.equal(result.warning, true);
  });
});
