import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPromptSuggestions,
  PROMPT_MAX_LENGTH,
} from "../src/promptSuggestions.js";
import type { DetectionResult } from "../src/detect/index.js";
import type { Finding, FindingKind } from "../src/detect/findings.js";
import type { ContextEntry } from "../src/history/context.js";

function finding(kind: FindingKind): Finding {
  return {
    kind,
    severity: "notice",
    date: "2026-08-19",
    headline: `${kind} headline`,
    detail: "detail",
    values: {},
  };
}

function ready(findings: Finding[]): DetectionResult {
  return { findings, coverage: { days: 73, ready: true, throughDate: null, staleDays: 0 } };
}

function entry(kind: ContextEntry["kind"], text: string): ContextEntry {
  return {
    id: 1,
    kind,
    text,
    effectiveFrom: "2026-08-01",
    effectiveTo: null,
    createdAt: 0,
  };
}

describe("prompt suggestions", () => {
  // The watch lays out a fixed menu; a short list leaves it rendering stale
  // entries from its own cache.
  it("always returns exactly five", () => {
    assert.equal(buildPromptSuggestions(ready([])).length, 5);
    assert.equal(buildPromptSuggestions(ready([finding("rhr_elevated")])).length, 5);
    assert.equal(
      buildPromptSuggestions(
        ready([
          finding("rhr_elevated"),
          finding("sleep_debt"),
          finding("hrv_trend_break"),
          finding("load_ratio_high"),
          finding("load_ratio_low"),
        ])
      ).length,
      5
    );
    assert.equal(
      buildPromptSuggestions({ findings: [], coverage: { days: 3, ready: false, throughDate: null, staleDays: 0 } }).length,
      5
    );
  });

  it("offers a question about what actually fired, first", () => {
    const prompts = buildPromptSuggestions(ready([finding("rhr_elevated")]));

    assert.match(prompts[0] ?? "", /resting HR/i);
  });

  it("puts findings ahead of the generic fill-ins", () => {
    const prompts = buildPromptSuggestions(ready([finding("sleep_debt")]));

    assert.match(prompts[0] ?? "", /sleep debt/i);
    assert.ok(prompts.includes("Should I train today?"));
    assert.ok(prompts.indexOf("Should I train today?") > 0);
  });

  it("asks about a race when one is on record", () => {
    const prompts = buildPromptSuggestions(
      ready([finding("rhr_elevated")]),
      [entry("race", "Baku Half Marathon")]
    );

    assert.ok(prompts.some((prompt) => /race prep/i.test(prompt)));
  });

  it("asks about an injury when one is on record", () => {
    const prompts = buildPromptSuggestions(ready([]), [entry("injury", "Left achilles")]);

    assert.ok(prompts.some((prompt) => /injury/i.test(prompt)));
  });

  it("falls back to the generic five when nothing has fired", () => {
    const prompts = buildPromptSuggestions(ready([]));

    assert.deepEqual(prompts, [
      "Should I train today?",
      "How is my recovery?",
      "Summarize my week",
      "How is my sleep trending?",
      "What should I focus on?",
    ]);
  });

  // Offering "Why is my resting HR up?" on day three, from four days of data,
  // would be a question the app cannot answer.
  it("offers cold-start questions before there is enough history", () => {
    const prompts = buildPromptSuggestions({
      findings: [],
      coverage: { days: 3, ready: false, throughDate: null, staleDays: 0 },
    });

    assert.match(prompts[0] ?? "", /how much data/i);
  });

  it("gives the identical list for the identical input", () => {
    const result = ready([finding("rhr_elevated"), finding("sleep_debt")]);
    const context = [entry("race", "Baku Half Marathon")];

    assert.deepEqual(
      buildPromptSuggestions(result, context),
      buildPromptSuggestions(result, context)
    );
  });

  it("never repeats a prompt", () => {
    const prompts = buildPromptSuggestions(
      ready([finding("rhr_elevated"), finding("rhr_elevated")])
    );

    assert.equal(new Set(prompts).size, 5);
  });

  it("keeps every prompt inside the width the watch can render", () => {
    const cases: DetectionResult[] = [
      ready([]),
      ready([finding("rhr_elevated"), finding("load_ratio_high")]),
      { findings: [], coverage: { days: 3, ready: false, throughDate: null, staleDays: 0 } },
    ];

    for (const result of cases) {
      for (const prompt of buildPromptSuggestions(result, [entry("race", "x")])) {
        assert.ok(
          prompt.length <= PROMPT_MAX_LENGTH,
          `"${prompt}" is ${prompt.length} characters, over the ${PROMPT_MAX_LENGTH} limit`
        );
      }
    }
  });
});

// The user's own questions, from the dashboard. They lead: a question someone
// took the trouble to write is a better use of a slot than one this file
// guessed, and there are only five slots.
describe("custom prompts", () => {
  it("leads with the user's questions, in the order they wrote them", () => {
    const prompts = buildPromptSuggestions(ready([finding("rhr_elevated")]), [], [
      "Is my knee ok to run on?",
      "How is my cycling FTP?",
    ]);

    assert.equal(prompts[0], "Is my knee ok to run on?");
    assert.equal(prompts[1], "How is my cycling FTP?");
  });

  it("still fills the rest from what actually fired", () => {
    const prompts = buildPromptSuggestions(ready([finding("sleep_debt")]), [], ["Is my knee ok?"]);

    assert.equal(prompts.length, 5);
    assert.equal(prompts[1], "How do I clear sleep debt?");
  });

  it("gives the whole menu over when the user wrote five", () => {
    const own = ["One?", "Two?", "Three?", "Four?", "Five?"];

    assert.deepEqual(buildPromptSuggestions(ready([finding("rhr_elevated")]), [], own), own);
  });

  // Their questions are theirs on day three as well. The cold-start list exists
  // because this file's own guesses would be unanswerable then, not because the
  // user's are.
  it("leads with them before there is enough history", () => {
    const prompts = buildPromptSuggestions(
      { findings: [], coverage: { days: 3, ready: false, throughDate: null, staleDays: 0 } },
      [],
      ["Is my knee ok?"]
    );

    assert.equal(prompts[0], "Is my knee ok?");
    assert.match(prompts[1] ?? "", /how much data/i);
    assert.equal(prompts.length, 5);
  });

  it("ignores blanks and trims what it keeps", () => {
    const prompts = buildPromptSuggestions(ready([]), [], ["  Is my knee ok?  ", "   ", ""]);

    assert.equal(prompts[0], "Is my knee ok?");
    assert.equal(prompts[1], "Should I train today?");
  });

  // The schema refuses these on write. This is the second line, because the
  // payload must not depend on when a stored row happened to be written.
  it("drops a question wider than the watch can render", () => {
    const tooWide = "x".repeat(PROMPT_MAX_LENGTH + 1);

    const prompts = buildPromptSuggestions(ready([]), [], [tooWide, "Is my knee ok?"]);

    assert.ok(!prompts.includes(tooWide));
    assert.equal(prompts[0], "Is my knee ok?");
  });

  it("does not repeat a question the user wrote and the app would have offered", () => {
    const prompts = buildPromptSuggestions(ready([]), [], ["Should I train today?"]);

    assert.equal(prompts[0], "Should I train today?");
    assert.equal(new Set(prompts).size, 5);
  });

  it("gives the identical list for the identical input", () => {
    const own = ["Is my knee ok?"];
    const result = ready([finding("rhr_elevated")]);

    assert.deepEqual(
      buildPromptSuggestions(result, [], own),
      buildPromptSuggestions(result, [], own)
    );
  });
});
