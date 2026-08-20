import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { startHistoryScheduler } from "../src/history/scheduler.js";

describe("history scheduler", () => {
  it("runs once immediately on start", async () => {
    let runs = 0;
    const stop = startHistoryScheduler({
      intervalMs: 60_000,
      run: async () => {
        runs += 1;
      },
    });

    await sleep(20);
    stop();

    assert.equal(runs, 1);
  });

  it("runs again on the interval", async () => {
    let runs = 0;
    const stop = startHistoryScheduler({
      intervalMs: 20,
      run: async () => {
        runs += 1;
      },
    });

    await sleep(90);
    stop();

    assert.ok(runs >= 3, `expected repeated runs, saw ${runs}`);
  });

  // A backfill can take an hour. Queueing ticks behind it would send a burst of
  // concurrent requests at Garmin the moment it finished, which is the one
  // thing the ingest pacing exists to prevent.
  it("skips a tick while the previous run is still going", async () => {
    let started = 0;
    const stop = startHistoryScheduler({
      intervalMs: 10,
      run: async () => {
        started += 1;
        await sleep(120);
      },
    });

    await sleep(80);
    stop();

    assert.equal(started, 1);
  });

  // The watch depends on this process staying up.
  it("swallows a failing run rather than taking the server down", async () => {
    let runs = 0;
    const stop = startHistoryScheduler({
      intervalMs: 15,
      run: async () => {
        runs += 1;
        throw new Error("Connect said no");
      },
    });

    await sleep(60);
    stop();

    assert.ok(runs >= 2, "a rejected run must not stop the schedule");
  });

  it("stops running once stopped", async () => {
    let runs = 0;
    const stop = startHistoryScheduler({
      intervalMs: 15,
      run: async () => {
        runs += 1;
      },
    });

    await sleep(20);
    stop();
    const afterStop = runs;

    await sleep(60);
    assert.equal(runs, afterStop);
  });
});
