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
