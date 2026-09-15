import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DateTime } from "luxon";
import { muteFromWatch, WATCH_MUTE_DAYS } from "../src/watchMute.js";
import { activeContext, allContext } from "../src/history/context.js";
import { applyMutes } from "../src/detect/mute.js";
import { closeHistoryDb, openHistoryDb } from "../src/history/store.js";
import type { Finding } from "../src/detect/findings.js";

// "Being able to ignore feedback that I can justify but the watch can't." The
// mute itself shipped on 2026-09-12 and could only be set from the dashboard,
// an MCP client or the CLI -- nowhere near the wrist that was showing the
// finding. From 2.1.0 the Today card offers it directly, for three days: long
// enough to cover the run of days a finding describes, short enough that
// forgetting you muted something is harmless.

const NOW = DateTime.fromISO("2026-09-15T08:30:00");

let directory: string;
let index = 0;

beforeEach(() => {
  closeHistoryDb();
  directory ??= fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-watch-mute-"));
  index += 1;
  openHistoryDb(path.join(directory, `mute-${index}.db`));
});

after(() => {
  closeHistoryDb();
  fs.rmSync(directory, { recursive: true, force: true });
});

function finding(kind: Finding["kind"], date = "2026-09-15"): Finding {
  return {
    kind,
    severity: "warn",
    date,
    headline: `${kind} headline`,
    short: kind,
    why: `${kind} rule`,
    detail: "detail",
    values: {},
  };
}

describe("muting a finding from the watch", () => {
  it("records a note that silences exactly that kind for three days", () => {
    const result = muteFromWatch("rhr_elevated", NOW);

    assert.equal(WATCH_MUTE_DAYS, 3);
    assert.equal(result.until, "2026-09-18");

    const entries = allContext();
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.kind, "note");
    assert.deepEqual(entries[0]?.mutes, ["rhr_elevated"]);
    assert.equal(entries[0]?.effectiveFrom, "2026-09-15");
    assert.equal(entries[0]?.effectiveTo, "2026-09-18");
    assert.match(entries[0]?.text ?? "", /watch/i);
  });

  it("silences the finding today and on the last covered day, and not after", () => {
    muteFromWatch("rhr_elevated", NOW);

    for (const [day, silenced] of [
      ["2026-09-15", true],
      ["2026-09-17", true],
      ["2026-09-18", false],
    ] as const) {
      const at = DateTime.fromISO(`${day}T09:00:00`);
      const result = applyMutes([finding("rhr_elevated", day)], activeContext(day), at);
      assert.equal(result.muted.length === 1, silenced, `on ${day}`);
    }
  });

  it("leaves every other kind alone", () => {
    muteFromWatch("rhr_elevated", NOW);
    const result = applyMutes([finding("sleep_debt")], activeContext("2026-09-15"), NOW);
    assert.equal(result.findings.length, 1);
  });

  it("does not stack a second entry when the same kind is muted twice", () => {
    const first = muteFromWatch("load_ratio_high", NOW);
    const second = muteFromWatch("load_ratio_high", NOW.plus({ hours: 2 }));
    assert.equal(allContext().length, 1);
    assert.equal(second.id, first.id);
  });

  it("refuses a kind it does not know, and refuses muting everything from a wrist", () => {
    assert.throws(() => muteFromWatch("coffee", NOW), /Unknown finding/);
    assert.throws(() => muteFromWatch("*", NOW), /Unknown finding/);
    assert.equal(allContext().length, 0);
  });
});
