import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The glance draws correctly, not merely without crashing.
 *
 * 2.0.3 fixed the crash that kept the glance from ever drawing, and the owner
 * then reported it on a Forerunner 70 as "sometimes not rendered properly":
 * text cut off, sometimes an empty strip, sometimes old or wrong numbers. The
 * simulator, fed a realistic cached summary, showed all of it at once:
 *
 *   - `dc.clear()` against COLOR_BLACK painted a flat black box over the themed
 *     card that newer devices draw behind the focused glance;
 *   - the finding headline was a sentence cut to "Resting HR 4 bp...";
 *   - the whole ~5 KB summary was deserialised out of Storage TWICE per draw,
 *     in a scope that has 32 KB in total on the Forerunner 55, 745 and
 *     Instinct 3 -- a day with a few findings is an out-of-memory crash, and
 *     on the wrist a crash is the launcher icon beside an empty strip;
 *   - recovery was coloured by 70/50 thresholds baked into the glance, while
 *     every card in the widget is coloured by the state the server graded
 *     against the user's own bands -- the two could disagree about one number.
 *
 * None of that is visible to a build or a type check. These tests pin the
 * decisions that fixed it, so the next edit to a file nobody runs cannot
 * quietly undo them. The pixels themselves are checked in the simulator.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "ciq", "source");

/** Empty for a missing file, so each test fails on its own claim rather than the suite on load. */
function read(name: string): string {
  const file = path.join(sourceDir, name);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

/** Source with `//` comments removed, so prose about a mistake is not the mistake. */
function code(name: string): string {
  return read(name)
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function functionBody(text: string, name: string): string {
  const start = text.search(new RegExp(`function\\s+${name}\\s*\\(`));
  assert.ok(start >= 0, `function ${name} not found`);
  const open = text.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  assert.fail(`could not find the end of function ${name}`);
}

describe("the glance draws what it should", () => {
  const view = code("TrainBudGlanceView.mc");
  const glanceData = code("GlanceData.mc");
  const app = code("TrainBudApp.mc");

  it("never paints an opaque background over the device's glance card", () => {
    const opaque = /setColor\([^,)]+,\s*Graphics\.COLOR_(?!TRANSPARENT)\w+\s*\)/g;
    const clears = [...view.matchAll(opaque)].map((m) => m[0]);
    assert.deepEqual(
      clears,
      [],
      `the glance sets an opaque background colour (${clears.join("; ")}). ` +
        "Newer devices draw a themed card behind the focused glance; an opaque " +
        "background covers it with a flat rectangle.",
    );
  });

  it("reads the small glance record, never the full summary", () => {
    assert.doesNotMatch(
      view,
      /"summary"/,
      "the glance names the full summary key. Deserialising the whole payload " +
        "in a 32 KB scope is what crashes it; read GlanceData's record instead.",
    );
    const reads = [...view.matchAll(/Storage\.getValue\(/g)].length;
    assert.equal(reads, 1, `the glance reads Storage ${reads} times per draw; once is enough`);
  });

  it("agrees with the writer about where the record lives", () => {
    const writerKey = /const\s+KEY\s*=\s*"([^"]+)"/.exec(glanceData)?.[1];
    const readerKey = /const\s+GLANCE_KEY\s*=\s*"([^"]+)"/.exec(view)?.[1];
    assert.ok(writerKey, "GlanceData.KEY not found");
    assert.equal(readerKey, writerKey, "the glance reads a different key than the app writes");
  });

  it("draws the title whatever the record holds, so a missing record is never a blank strip", () => {
    const body = functionBody(view, "onUpdate");
    const title = body.search(/drawTitle\(/);
    assert.ok(title >= 0, "onUpdate does not draw the title");
    assert.doesNotMatch(
      body.slice(0, title),
      /\breturn\b/,
      "onUpdate can return before the title is drawn, leaving the strip empty",
    );
  });

  it("grades nothing itself -- colours come from the server's states", () => {
    assert.doesNotMatch(
      view,
      />=\s*(50|70)\b/,
      "the glance carries its own recovery thresholds again; the widget colours " +
        "by the server's graded state, and the two must not disagree",
    );
    assert.match(glanceData, /Palette\.forState\(/, "the record's colours should come from Palette.forState");
  });

  it("is refreshed every time a summary is persisted or restored from cache", () => {
    assert.match(functionBody(app, "persistSummary"), /GlanceData\.write\(/);
    assert.match(functionBody(app, "loadCachedSummary"), /GlanceData\.write\(/);
  });

  it("keeps the record writer out of the glance scope", () => {
    const raw = read("GlanceData.mc");
    assert.doesNotMatch(
      raw,
      /\(:glance\)\s*\n\s*module\s+GlanceData/,
      "GlanceData is annotated (:glance); its writer would be loaded into the glance's 32 KB for nothing",
    );
  });
});
