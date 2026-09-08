import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The glance is built in its own scope, and the app class is built into it.
 *
 * Connect IQ instantiates `TrainBudApp` inside the glance scope in order to ask
 * it for `getGlanceView()`, so every field initializer on that class runs
 * there -- in a scope that contains only `(:glance)` code. `Cards` is not in
 * it, and `private var _cardOrder = Cards.defaultOrder()` therefore killed the
 * glance on load with
 *
 *     Illegal Access (Out of Bounds) - Failed invoking <symbol>
 *
 * before `onUpdate` was ever reached. On the wrist that is the launcher icon
 * with an empty strip beside it: no name, no numbers, no finding. It shipped
 * that way in the same commit that added the glance and survived every release
 * since, because nothing in the widget notices -- the widget scope has `Cards`
 * and draws perfectly.
 *
 * Nothing failed. The build was green, the store accepted the package, and the
 * only symptom was a blank strip that looks like an app with nothing to say.
 * This test is the thing that fails.
 *
 * Note the distinction it draws: a bare `const` reference such as `Fail.NONE`
 * is folded by the compiler and is safe in the same position -- three of those
 * sit in this class today and the glance loads. A *call* is resolved at run
 * time and is not.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "ciq", "source");

const sources = fs
  .readdirSync(sourceDir)
  .filter((name) => name.endsWith(".mc"))
  .map((name) => ({ name, text: fs.readFileSync(path.join(sourceDir, name), "utf8") }));

/** Every module and class declared in ciq/source, and whether it is `(:glance)`. */
function localScopes(): Map<string, boolean> {
  const found = new Map<string, boolean>();
  for (const { text } of sources) {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const declared = /^\s*(?:module|class)\s+(\w+)/.exec(lines[i] ?? "");
      const name = declared?.[1];
      if (!name) continue;
      // The annotation sits directly above the declaration it applies to.
      const annotated = (lines[i - 1] ?? "").trim() === "(:glance)";
      found.set(name, annotated);
    }
  }
  return found;
}

/** The part of TrainBudApp that runs when the class is constructed. */
function constructionRegion(): string {
  const app = sources.find((s) => s.name === "TrainBudApp.mc");
  assert.ok(app, "ciq/source/TrainBudApp.mc is missing");

  const classStart = app.text.indexOf("class TrainBudApp");
  assert.ok(classStart >= 0, "TrainBudApp class declaration not found");

  const initStart = app.text.indexOf("function initialize()", classStart);
  assert.ok(initStart >= 0, "TrainBudApp.initialize() not found");

  // Field and const declarations, plus the constructor body itself: both run
  // before getGlanceView() can return.
  const initEnd = app.text.indexOf("\n    }", initStart);
  assert.ok(initEnd >= 0, "could not find the end of TrainBudApp.initialize()");

  return app.text.slice(classStart, initEnd);
}

describe("the app class can be constructed inside the glance scope", () => {
  const scopes = localScopes();

  it("knows about the modules this repo declares", () => {
    // A sanity check on the parser itself: if this stops finding Cards, the
    // test below would pass by seeing nothing at all.
    assert.equal(scopes.get("Cards"), false, "Cards should be a non-glance module");
    assert.equal(
      scopes.get("TrainBudGlanceView"),
      true,
      "TrainBudGlanceView should carry (:glance)",
    );
  });

  it("calls into no module that the glance scope does not have", () => {
    const region = constructionRegion();
    const offenders: string[] = [];

    // `Name.method(` -- a call, resolved at run time. Bare const reads are
    // deliberately not matched; see the note at the top of this file.
    for (const match of region.matchAll(/\b([A-Z]\w*)\.(\w+)\s*\(/g)) {
      const owner = match[1];
      const member = match[2];
      if (!owner || !member) continue;
      if (!scopes.has(owner)) continue; // Toybox and the SDK are in both scopes.
      if (scopes.get(owner) === true) continue; // annotated (:glance), fine.
      offenders.push(`${owner}.${member}()`);
    }

    assert.deepEqual(
      offenders,
      [],
      `TrainBudApp construction calls ${offenders.join(", ")}, which the glance ` +
        `scope does not contain. The glance will fail to load with "Illegal ` +
        `Access (Out of Bounds)" and draw nothing. Move the call out of the ` +
        `field initializer and build the value on first use instead.`,
    );
  });

  it("keeps the glance view itself free of non-glance modules", () => {
    const view = sources.find((s) => s.name === "TrainBudGlanceView.mc");
    assert.ok(view, "ciq/source/TrainBudGlanceView.mc is missing");

    const offenders: string[] = [];
    for (const match of view.text.matchAll(/\b([A-Z]\w*)\.(\w+)\s*\(/g)) {
      const owner = match[1];
      const member = match[2];
      if (!owner || !member) continue;
      if (!scopes.has(owner)) continue;
      if (scopes.get(owner) === true) continue;
      offenders.push(`${owner}.${member}()`);
    }

    assert.deepEqual(offenders, [], `glance view calls ${offenders.join(", ")}`);
  });
});
