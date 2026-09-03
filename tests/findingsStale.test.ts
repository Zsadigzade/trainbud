import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderFindingsText } from "../src/tools/findings.js";
import { describeFindingsCoverage } from "../src/detect/index.js";

// The reported bug, one layer further down than where it was fixed.
//
// `coverage.ready` carries two different refusals: "there is not enough history
// yet" and "there is plenty and it stops weeks ago". bb1fae8 taught the watch
// prompt to tell them apart. The MCP tool and the CLI kept the single
// cold-start sentence, so on a real 74-day store ending 2026-08-21 the one tool
// that reads the store told the model:
//
//     Still gathering data - 74 of the 14 days needed
//
// which is not only wrong, it is arithmetically absurd, and it is the sentence
// a model repeats back as "I don't have access to your data".
//
// Measured against the live install on 2026-09-03 before the fix.

const STALE = {
  days: 74,
  ready: false,
  throughDate: "2026-08-21",
  staleDays: 13,
};

const COLD = {
  days: 4,
  ready: false,
  throughDate: "2026-09-02",
  staleDays: 1,
};

const EMPTY = {
  days: 0,
  ready: false,
  throughDate: null,
  staleDays: 0,
};

describe("a stale store is not a cold start", () => {
  it("never claims 74 days are fewer than the 14 needed", () => {
    const text = renderFindingsText({ findings: [], coverage: STALE });

    assert.doesNotMatch(text, /Still gathering/i);
    assert.doesNotMatch(text, /74 of the 14/);
  });

  it("names the date the record stops and how old that is", () => {
    const text = renderFindingsText({ findings: [], coverage: STALE });

    assert.match(text, /74 days/);
    assert.match(text, /2026-08-21/);
    assert.match(text, /13 days/);
  });

  it("tells the reader the history is real and worth reasoning about", () => {
    const text = renderFindingsText({ findings: [], coverage: STALE });

    // The whole point. A model handed this must not conclude it has no data.
    assert.doesNotMatch(text, /no data/i);
    assert.match(text, /backfill/);
  });

  it("still says it is gathering when the store really is short", () => {
    const text = renderFindingsText({ findings: [], coverage: COLD });

    assert.match(text, /Still gathering/i);
    assert.match(text, /4 of the 14/);
  });

  it("treats an empty store as a cold start, not as a stale one", () => {
    const text = renderFindingsText({ findings: [], coverage: EMPTY });

    assert.match(text, /Still gathering/i);
    assert.doesNotMatch(text, /stops/);
  });
});

// One description, three surfaces. The bug above exists because each surface
// wrote the sentence itself and only one of them was taught the difference.
describe("every surface reads one coverage description", () => {
  it("classifies a deep but stale store as stale", () => {
    assert.equal(describeFindingsCoverage(STALE).state, "stale");
  });

  it("classifies a short store as cold", () => {
    assert.equal(describeFindingsCoverage(COLD).state, "cold");
    assert.equal(describeFindingsCoverage(EMPTY).state, "cold");
  });

  it("classifies a current, deep store as ready", () => {
    assert.equal(
      describeFindingsCoverage({
        days: 74,
        ready: true,
        throughDate: "2026-09-03",
        staleDays: 0,
      }).state,
      "ready"
    );
  });
});
