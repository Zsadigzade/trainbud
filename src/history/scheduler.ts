import { withGarminClient } from "../garmin/client.js";
import { logger } from "../utils/logger.js";
import { runIngest, type IngestResult } from "./ingest.js";

// SECTION: History scheduler
//
// There is no daemon and the machine is not always on, but Garmin retains the
// history, so any gap is recoverable. Catching up on start and then ticking
// while the process lives is enough to keep a year current without asking the
// user to run anything or install a service.

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

export interface HistorySchedulerOptions {
  intervalMs?: number;
  run?: () => Promise<unknown>;
}

async function catchUp(): Promise<IngestResult> {
  return withGarminClient(async (client) => runIngest(client));
}

/**
 * Returns its own stop function.
 *
 * Three properties this must keep:
 *
 * 1. The timer is unref()'d. A referenced interval holds the Node event loop
 *    open, which is exactly the bug that made `npm test` hang until something
 *    killed it (802d4d8) -- do not reintroduce it in a different shape.
 * 2. Runs never overlap. A backfill can take an hour; queueing ticks behind it
 *    would fire a burst of concurrent requests at Garmin the moment it
 *    finished, which is the one thing the ingest pacing exists to prevent.
 * 3. A failing run is logged and swallowed. The watch depends on this process
 *    staying up, and a Garmin outage must not take the HTTP server with it.
 */
export function startHistoryScheduler(options: HistorySchedulerOptions = {}): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const run = options.run ?? catchUp;

  let running = false;
  let stopped = false;

  const tick = (): void => {
    if (stopped || running) {
      return;
    }

    running = true;
    void run()
      .catch((error: unknown) => {
        logger.warn({ error }, "History catch-up failed");
      })
      .finally(() => {
        running = false;
      });
  };

  tick();

  const timer = setInterval(tick, intervalMs);
  timer.unref();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
