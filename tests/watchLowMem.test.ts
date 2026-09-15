import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The Forerunner 55 widget has 64 KB. 2.0.4 used 55.5 KB of it with an ordinary
// payload, and the 2.1.0 finding detail, mute and sleep footnote -- about 7 KB of
// code -- ran it out of memory loading the cached summary in the simulator.
// Those pieces carry (:fullUi) with a (:lowMem) stub beside each, and the
// jungles compile one side or the other per device.
//
// Two ways this breaks, both silently until someone builds the wrong overlay:
//   * an overlay sets base.excludeAnnotations without lowMem, so a normal device
//     compiles BOTH halves and the build fails on a redefinition;
//   * an overlay forgets the fr55 line, so fr55 inherits the base list, compiles
//     the full UI, and runs out of memory on the wrist.
// A jungle setting is assigned, not appended, which is why every overlay has to
// restate both.

const ciq = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), "ciq");

function setting(text: string, key: string): string[] | null {
  const match = new RegExp(`^${key.replace(".", "\\.")}\\s*=\\s*(.+)$`, "m").exec(text);
  return match ? match[1]!.split(";").map((part) => part.trim()).filter(Boolean) : null;
}

const jungles = fs.readdirSync(ciq).filter((name) => name.endsWith(".jungle"));

describe("the low-memory split is configured in every jungle that could undo it", () => {
  it("finds the jungles", () => {
    assert.ok(jungles.includes("monkey.jungle"));
    assert.ok(jungles.length >= 4);
  });

  for (const name of jungles) {
    const text = fs.readFileSync(path.join(ciq, name), "utf8");
    const base = setting(text, "base.excludeAnnotations");
    if (base === null) {
      continue;
    }

    it(`${name}: excludes the stubs everywhere and the full UI on fr55`, () => {
      assert.ok(base.includes("lowMem"), `${name} base.excludeAnnotations lacks lowMem: ${base.join(";")}`);
      assert.ok(!base.includes("fullUi"), `${name} excludes the full UI on every device`);

      const fr55 = setting(text, "fr55.excludeAnnotations");
      assert.ok(fr55, `${name} sets base.excludeAnnotations but not fr55.excludeAnnotations`);
      assert.ok(fr55.includes("fullUi") && !fr55.includes("lowMem"), `${name} fr55: ${fr55.join(";")}`);

      // Everything else the overlay excludes still has to apply to fr55.
      const rest = base.filter((part) => part !== "lowMem");
      for (const part of rest) {
        assert.ok(fr55.includes(part), `${name} fr55 line drops "${part}"`);
      }
    });
  }
});

describe("every (:fullUi) function that shared code calls has a (:lowMem) twin", () => {
  const source = path.join(ciq, "source");
  for (const file of fs.readdirSync(source).filter((name) => name.endsWith(".mc"))) {
    const text = fs.readFileSync(path.join(source, file), "utf8");
    const stubs = new Set(
      [...text.matchAll(/\(:lowMem\)\s*(?:private\s+)?function\s+(\w+)/g)].map((m) => m[1]!)
    );
    for (const stub of stubs) {
      it(`${file}: ${stub} exists in both builds`, () => {
        assert.match(text, new RegExp(`\\(:fullUi\\)\\s*(?:private\\s+)?function\\s+${stub}\\b`));
      });
    }
  }
});

describe("card positions are never compared with card ids", () => {
  // getCardIndex() is a Number and Cards.* are Strings since cards became ids.
  // `app.getCardIndex() == Cards.ASK_AI` was always false, so BACK on an AI
  // answer left the widget instead of returning to the menu.
  it("has no getCardIndex() == Cards.X anywhere in the watch source", () => {
    const source = path.join(ciq, "source");
    for (const file of fs.readdirSync(source).filter((name) => name.endsWith(".mc"))) {
      const text = fs.readFileSync(path.join(source, file), "utf8");
      assert.doesNotMatch(text, /getCardIndex\(\)\s*[!=]=\s*Cards\./, file);
    }
  });
});
