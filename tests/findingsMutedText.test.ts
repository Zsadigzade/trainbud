import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderFindingsText } from "../src/tools/findings.js";
import { formatFindingsContext } from "../src/promptApi.js";
import type { Coverage } from "../src/detect/index.js";
import type { Finding, MutedFinding } from "../src/detect/findings.js";

const READY: Coverage = { days: 73, ready: true, throughDate: "2026-09-12", staleDays: 0 };

const finding: Finding = {
  kind: "rhr_elevated",
  severity: "warn",
  date: "2026-09-12",
  headline: "Resting heart rate 5 bpm above your 28-day baseline, 3 days running",
  detail: "Easy training or a rest day is the low-risk call until it settles.",
  values: { deltaBpm: 5 },
};

const muted: MutedFinding = {
  ...finding,
  mutedBy: { id: 3, kind: "note", text: "travelling, hotel beds" },
};

describe("what a muted finding does to the sentence the model is given", () => {
  // The failure this guards against is the one this codebase has already paid
  // for once: an absence reported as a clean bill of health. A finding the user
  // silenced is not an absence, and a model told "nothing stands out" repeats it
  // back as reassurance.
  it("never says nothing stands out while something is being held back", () => {
    const text = renderFindingsText({ findings: [], muted: [muted], coverage: READY });

    assert.doesNotMatch(text, /^Nothing stands out against/);
    assert.match(text, /already explained/i);
  });

  it("still says nothing stands out on a genuinely quiet day", () => {
    const text = renderFindingsText({ findings: [], muted: [], coverage: READY });

    assert.match(text, /Nothing stands out against/);
  });

  it("names the muted finding and the user's own reason for it", () => {
    const text = renderFindingsText({ findings: [], muted: [muted], coverage: READY });

    assert.match(text, /Resting heart rate 5 bpm/);
    assert.match(text, /travelling, hotel beds/);
  });

  it("tells the model not to raise a muted finding as a concern", () => {
    const text = renderFindingsText({ findings: [], muted: [muted], coverage: READY });

    assert.match(text, /not raise these as concerns/i);
  });

  it("counts only the live findings in the headline count", () => {
    const text = renderFindingsText({ findings: [finding], muted: [muted], coverage: READY });

    assert.match(text, /1 finding\(s\)/);
  });
});

describe("what the watch's Ask prompt is told", () => {
  it("separates what stands out from what the user explained", () => {
    const text = formatFindingsContext({ findings: [], muted: [muted], coverage: READY }, []);

    assert.doesNotMatch(text, /nothing stands out against this user's own baselines/i);
    assert.match(text, /already explained/i);
    assert.match(text, /they logged: travelling, hotel beds/);
  });

  it("leaves a quiet day reading as a quiet day", () => {
    const text = formatFindingsContext({ findings: [], muted: [], coverage: READY }, []);

    assert.match(text, /nothing stands out/i);
    assert.doesNotMatch(text, /explained/i);
  });
});
