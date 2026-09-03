import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { DateTime } from "luxon";
import { __toGarminDateForTest as toGarminDate } from "../src/garmin/rawApi.js";
import { getDateRange, getDatesBetween } from "../src/utils/helpers.js";

/**
 * `d64a78a` fixed the wrong-day fetch in garmin-connect's own date handling,
 * which was broken WEST of UTC. The raw API kept its own converter and that one
 * is broken EAST of UTC: it read a local-midnight Date `{ zone: "utc" }`, which
 * asks which UTC day the instant falls on rather than which day the Date stands
 * for. At UTC+4, where this was written, every stress and VO2 max request asked
 * Connect about the previous day and stamped the answer with it too.
 *
 * The earlier bug survived because its test asserted `toISOString()` — a
 * property of which midnight the Date sits on, not of the day Garmin gets asked
 * about. This asserts the day in the URL.
 *
 * The zone has to be changed for the PROCESS, not by building a Date in a
 * foreign zone: `getDateRange` calls `DateTime.local()`, so the zone under test
 * is whichever one node started in. Building a Date at Auckland midnight and
 * reading it back in Baku tests nothing that happens in production — the first
 * draft of this file did exactly that and failed for the wrong reason.
 */
describe("the day the raw API actually asks Garmin about", () => {
  it("round-trips the Dates the tools actually build", () => {
    for (const date of getDateRange(5)) {
      assert.equal(
        toGarminDate(date),
        DateTime.fromJSDate(date).toFormat("yyyy-MM-dd"),
        "getDateRange makes local-midnight Dates; they must read back as that same day"
      );
    }

    for (const date of getDatesBetween("2026-08-28", "2026-09-02")) {
      assert.equal(toGarminDate(date), DateTime.fromJSDate(date).toFormat("yyyy-MM-dd"));
    }
  });

  it("asks about six distinct days when six days are requested", () => {
    const asked = getDateRange(6).map(toGarminDate);
    assert.equal(new Set(asked).size, 6, "a shift that collapses two days would show here");
  });

  it("asks about today, not yesterday, in zones on both sides of UTC", () => {
    // Asia/Baku and Pacific/Auckland are east of UTC, which is where the old
    // converter lost a day. Los Angeles is west, where it happened to be right,
    // so a fix that merely moved the error would fail here.
    for (const zone of ["Asia/Baku", "Pacific/Auckland", "Europe/London", "America/Los_Angeles", "UTC"]) {
      const { meant, asked } = askedDayIn(zone);
      assert.equal(asked, meant, `in ${zone} the request must name ${meant}, not ${asked}`);
    }
  });
});

/**
 * Run the conversion in a child node process with TZ set, which is the only way
 * to move what `DateTime.local()` returns.
 */
function askedDayIn(zone: string): { meant: string; asked: string } {
  const script = `
    import { DateTime } from "luxon";
    import { __toGarminDateForTest as toGarminDate } from "./src/garmin/rawApi.ts";
    import { getDateRange } from "./src/utils/helpers.ts";
    const today = getDateRange(1)[0];
    process.stdout.write(JSON.stringify({
      meant: DateTime.local().toFormat("yyyy-MM-dd"),
      asked: toGarminDate(today),
    }));
  `;

  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script],
    { env: { ...process.env, TZ: zone }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
  );

  return JSON.parse(output) as { meant: string; asked: string };
}
