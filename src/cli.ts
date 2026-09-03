import { Command, InvalidArgumentError } from "commander";
import { authenticateGarmin, clearStoredSession, sessionExists } from "./garmin/auth.js";
import { closeCache, getCache } from "./garmin/cache.js";
import { resetGarminClient } from "./garmin/client.js";
import { createMcpServer } from "./server.js";
import { createHttpMcpServer, getRemoteConnectorInstructions } from "./httpServer.js";
import { assertGarminCredentials, appConfig, assertApiKey, deprecatedEnvNames } from "./config.js";
import { DATA_DIR_NAME, LEGACY_DATA_DIR_NAME, migrateLegacyDataDir } from "./paths.js";
import { configureLogger, logger } from "./utils/logger.js";
import { packageVersion } from "./version.js";
import { runSetup } from "./setup.js";
import { withGarminClient } from "./garmin/client.js";
import { DEFAULT_SOURCES, runIngest } from "./history/ingest.js";
import { GarminApiError } from "./garmin/types.js";
import { startHistoryScheduler } from "./history/scheduler.js";
import {
  closeHistoryDb,
  historyStats,
  pruneRawPayloads,
  RAW_RETENTION_DAYS,
  RAW_REVISIONS_KEPT,
} from "./history/store.js";
import { runDetectors } from "./detect/index.js";
import type { IngestSource } from "./history/schema.js";
import { printLiveCheckResults, runLiveCheck } from "./check.js";

// SECTION: Bootstrap
//
// Runs before every command. Moves pre-0.3.0 state out of `.garmin/` and warns
// once about renamed environment variables, so an existing install keeps its
// session, cache and watch pairing across the rename.

/**
 * A numeric option, or a clear refusal.
 *
 * Number.parseInt("abc") is NaN, and NaN flowed straight through: `--days abc`
 * printed "Backfilling NaN days", every date arithmetic produced Invalid Date,
 * and the run did nothing while reporting that it was working. `--delay-ms abc`
 * was worse -- a NaN delay is not a pause, so the throttle between Garmin
 * requests silently disappeared on the one command that makes hundreds of them.
 */
function positiveIntOption(name: string, min = 1) {
  return (value: string): number => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < min) {
      throw new InvalidArgumentError(
        `${name} must be a whole number of at least ${min}. Got "${value}".`
      );
    }
    return parsed;
  };
}

/**
 * Print a failure the way its cause deserves.
 *
 * A Garmin rate limit is an expected, actionable wait, and it was being reported
 * with `logger.error` plus a full stack trace — so the screen filled with a
 * kilobyte of Cloudflare JSON and a stack, and the one line that mattered ("wait
 * N seconds") was buried in the middle of it. That reads as a crash, and the
 * natural response to a crash is to run the command again, which is exactly the
 * behaviour that extends the block.
 */
function reportCliFailure(error: unknown, fallback: string): void {
  const rateLimited =
    error instanceof GarminApiError && error.statusCode === 429 ? error : null;

  if (rateLimited) {
    logger.warn({ retryAfterSeconds: rateLimited.retryAfterSeconds }, fallback);
    console.error("");
    console.error(rateLimited.message);
    console.error("Nothing was lost — every day already fetched is checkpointed.");
    return;
  }

  logger.error({ error }, fallback);
  console.error(error instanceof Error ? error.message : fallback);
}

function bootstrap(): void {
  // stdio transport speaks MCP on stdout — never print there.
  const notify = (message: string): void => {
    process.stderr.write(`${message}\n`);
  };

  try {
    const result = migrateLegacyDataDir();
    if (result.migrated) {
      notify(
        `Migrated ${result.movedEntries?.length ?? 0} item(s) from ${LEGACY_DATA_DIR_NAME}/ to ${DATA_DIR_NAME}/.`
      );
    }
  } catch (error) {
    notify(
      `Could not migrate ${LEGACY_DATA_DIR_NAME}/ to ${DATA_DIR_NAME}/: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    notify(`Move the directory manually, or run "trainbud setup" to start fresh.`);
  }

  const deprecated = deprecatedEnvNames();
  if (deprecated.length > 0) {
    notify(
      `Deprecated environment variable(s) in use: ${deprecated.join(", ")}. ` +
        `These still work but were renamed to TRAINBUD_*; run "trainbud setup" to rewrite .env.`
    );
  }
}

// SECTION: CLI Commands

async function runStart(): Promise<void> {
  assertGarminCredentials();
  configureLogger(appConfig.logPath);

  const server = createMcpServer();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutting down TrainBud server");
    await server.close();
    closeCache();
    process.exit(0);
  };

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("exit", () => {
    closeCache();
  });

  await server.start();
}

async function runAuth(): Promise<void> {
  configureLogger(appConfig.logPath);
  clearStoredSession();
  resetGarminClient();
  await authenticateGarmin(true);
  console.log("Garmin authentication successful. Session saved.");
}

function runCacheClear(): void {
  const cache = getCache();
  const removed = cache.clear();
  console.log(`Cleared ${removed} cache entries.`);
}

async function runStatus(): Promise<void> {
  const cache = getCache();
  const cacheStats = cache.stats();

  console.log("TrainBud status");
  console.log(`Session: ${sessionExists() ? "present" : "missing"}`);
  console.log(`Cache entries: ${cacheStats.entries}`);
  console.log(`Expired cache entries: ${cacheStats.expiredEntries}`);

  const history = historyStats();
  const span =
    history.oldestDate && history.newestDate
      ? `${history.oldestDate} to ${history.newestDate}`
      : "empty — run `trainbud backfill`";

  console.log(`History span: ${span}`);
  console.log(`History measurements: ${history.metricRows}`);
  console.log(`History raw payloads: ${history.rawRows}`);
  console.log(`History activities: ${history.activityRows}`);
  if (history.emptyDays > 0) {
    // Almost always days before the watch was bought. Reported so a small span
    // reads as "that is all Garmin has" rather than as a broken backfill.
    console.log(`Days Garmin had no data for: ${history.emptyDays}`);
  }
  closeHistoryDb();
}

async function runPrune(retentionDays: number): Promise<void> {
  const before = historyStats();
  const result = pruneRawPayloads(undefined, retentionDays);
  const after = historyStats();

  console.log("TrainBud prune — raw payload archive only");
  console.log(`Dropped for being older than ${retentionDays} days: ${result.agedOut}`);
  console.log(
    `Dropped for being past revision ${RAW_REVISIONS_KEPT} of a day: ${result.supersededRevisions}`
  );
  console.log(`Raw payloads: ${before.rawRows} → ${after.rawRows}`);
  console.log(
    `Measurements and activities untouched: ${after.metricRows} measurements, ${after.activityRows} activities.`
  );
  closeHistoryDb();
}

async function runFindings(): Promise<void> {
  const result = runDetectors();

  if (!result.coverage.ready) {
    console.log(
      `Still gathering data — ${result.coverage.days} of the 14 days needed before anything can be compared to a baseline.`
    );
    console.log("Run `trainbud backfill` to pull what Garmin already holds.");
    closeHistoryDb();
    return;
  }

  console.log(`TrainBud findings — ${result.coverage.days} days of history`);
  console.log("");

  if (result.findings.length === 0) {
    console.log("Nothing stands out against your own baselines.");
    closeHistoryDb();
    return;
  }

  for (const finding of result.findings) {
    console.log(`[${finding.severity}] ${finding.headline}`);
    console.log(`  ${finding.detail}`);
    console.log("");
  }

  console.log("General training guidance only. Not medical advice.");
  closeHistoryDb();
}

async function runBackfill(options: {
  days?: number;
  delayMs?: number;
  source?: string[];
  capture?: string;
  earlyStop?: boolean;
}): Promise<void> {
  assertGarminCredentials();

  const sources = options.source?.length
    ? options.source.map((name) => {
        if (!DEFAULT_SOURCES.includes(name as IngestSource)) {
          throw new Error(
            `Unknown source "${name}". Choose from: ${DEFAULT_SOURCES.join(", ")}`
          );
        }
        return name as IngestSource;
      })
    : DEFAULT_SOURCES;

  const days = options.days ?? 365;
  const delayMs = options.delayMs ?? 1000;

  console.log(
    `Backfilling ${days} days from ${sources.length} sources, ${delayMs}ms apart.`
  );
  console.log("Safe to interrupt — every day is checkpointed and the next run resumes.");
  if (options.capture) {
    console.log(`Capturing redacted responses to ${options.capture} — read them before committing.`);
  }
  console.log("");

  const result = await withGarminClient(async (client) =>
    runIngest(client, {
      days,
      delayMs,
      sources,
      captureDir: options.capture,
      stopAfterEmptyDays: options.earlyStop === false ? 0 : undefined,
      onProgress: (progress) => {
        // One line per day so an hour-long run is legible and a stall is
        // obvious. This is the only feedback the user gets while it walks a
        // year.
        console.log(
          `[${progress.done}/${progress.total}] ${progress.source} ${progress.date} — ${progress.outcome}`
        );
      },
    })
  );

  console.log("");
  console.log(
    `Done. ${result.fetched} fetched, ${result.errors} failed, ${result.skipped} skipped.`
  );
  if (result.stoppedBy === "rate_limit") {
    console.log("");
    console.log("Garmin rate limited this run, so it stopped rather than making");
    console.log("hundreds more requests that could not have succeeded. Wait a few");
    console.log("minutes and run it again — every day already fetched is checkpointed.");
  } else if (result.errors > 0) {
    console.log("Failed days are retried automatically on the next run.");
  }
  closeHistoryDb();
}

async function runCheck(): Promise<void> {
  const results = await runLiveCheck();
  printLiveCheckResults(results);

  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

async function runServe(): Promise<void> {
  assertGarminCredentials();
  assertApiKey();

  const server = createHttpMcpServer();

  // Catch up on start, then hourly while this process lives. Garmin retains
  // the history, so a machine that was off overnight loses nothing -- the gap
  // is simply the next run's work.
  let stopHistory: (() => void) | null = null;

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutting down TrainBud HTTP server");
    stopHistory?.();
    closeHistoryDb();
    await server.close();
    process.exit(0);
  };

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  await server.start();
  stopHistory = startHistoryScheduler();

  console.log(`TrainBud HTTP MCP server running at http://${appConfig.mcpHost}:${appConfig.mcpPort}/mcp`);
  console.log(`Health check: http://${appConfig.mcpHost}:${appConfig.mcpPort}/health`);
  console.log("");
  console.log(getRemoteConnectorInstructions(`https://your-tunnel-url.example.com`));
}

export function createCliProgram(): Command {
  const program = new Command();

  program.hook("preAction", () => {
    bootstrap();
  });

  program
    .name("trainbud")
    .description("TrainBud — MCP server for Garmin Connect fitness data")
    .version(packageVersion);

  program
    .command("start")
    .description("Start the MCP server using stdio transport")
    .action(async () => {
      try {
        await runStart();
      } catch (error) {
        logger.error({ error }, "Failed to start MCP server");
        process.exitCode = 1;
      }
    });

  program
    .command("auth")
    .description("Force Garmin re-authentication")
    .action(async () => {
      try {
        await runAuth();
      } catch (error) {
        logger.error({ error }, "Garmin authentication failed");
        console.error(error instanceof Error ? error.message : "Authentication failed");
        process.exitCode = 1;
      }
    });

  const cacheCommand = program.command("cache").description("Manage local cache");

  cacheCommand
    .command("clear")
    .description("Clear all cached Garmin data")
    .action(() => {
      try {
        runCacheClear();
      } catch (error) {
        logger.error({ error }, "Failed to clear cache");
        process.exitCode = 1;
      }
    });

  program
    .command("serve")
    .description("Start remote MCP server (Streamable HTTP) for web AI connectors")
    .option("-p, --port <number>", "HTTP port", positiveIntOption("--port"))
    .option("-H, --host <host>", "Bind host")
    .action(async (options: { port?: number; host?: string }) => {
      try {
        if (options.port) {
          process.env.TRAINBUD_PORT = String(options.port);
        }
        if (options.host) {
          process.env.TRAINBUD_HOST = options.host;
        }
        await runServe();
      } catch (error) {
        logger.error({ error }, "Failed to start HTTP MCP server");
        console.error(error instanceof Error ? error.message : "Failed to start HTTP MCP server");
        process.exitCode = 1;
      }
    });

  program
    .command("backfill")
    .description("Fetch Garmin history into the local store — resumable, safe to interrupt")
    .option("-d, --days <number>", "How many days back to fetch", positiveIntOption("--days"))
    .option("--delay-ms <number>", "Delay between requests", positiveIntOption("--delay-ms", 0))
    .option(
      "-s, --source <name>",
      "Limit to one source (repeatable)",
      (value: string, previous: string[] = []) => [...previous, value]
    )
    .option("--capture <dir>", "Also write each redacted response there, as a test fixture")
    .option(
      "--no-early-stop",
      "Keep asking past a long run of empty days instead of assuming the record has run out"
    )
    .action(async (options: {
      days?: number;
      delayMs?: number;
      source?: string[];
      capture?: string;
      earlyStop?: boolean;
    }) => {
      try {
        await runBackfill(options);
      } catch (error) {
        reportCliFailure(error, "Backfill failed");
        process.exitCode = 1;
      }
    });

  program
    .command("findings")
    .description("Show what stands out in your history, against your own baselines")
    .action(async () => {
      try {
        await runFindings();
      } catch (error) {
        logger.error({ error }, "Failed to compute findings");
        console.error(error instanceof Error ? error.message : "Failed to compute findings");
        process.exitCode = 1;
      }
    });

  program
    .command("setup")
    .description("Interactive first-time setup — credentials, auth, and MCP client config")
    .action(async () => {
      try {
        await runSetup();
      } catch (error) {
        logger.error({ error }, "Setup failed");
        console.error(error instanceof Error ? error.message : "Setup failed");
        process.exitCode = 1;
      }
    });

  program
    .command("check")
    .description("Run live diagnostics against all TrainBud tools")
    .action(async () => {
      try {
        await runCheck();
      } catch (error) {
        reportCliFailure(error, "Live check failed");
        process.exitCode = 1;
      }
    });

  // Separate from `check`, which exercises the Garmin tools. This asks the one
  // question `check` cannot: what would the watch see if it called right now.
  // The -400 report took days partly because every diagnostic ran on this
  // machine, where everything was genuinely healthy; the broken hop was the one
  // nothing looked at from the outside.
  program
    .command("doctor")
    .description("Check what the watch would see: public URL, AI key, history depth")
    .action(async () => {
      try {
        const { runSelfTest } = await import("./selfTest.js");
        const result = await runSelfTest();

        console.log("");
        console.log("TrainBud doctor");
        console.log("");
        for (const check of result.checks) {
          const mark = check.ok ? "✓" : check.warning ? "!" : "✗";
          console.log(`  ${mark}  ${check.name}`);
          console.log(`     ${check.detail}`);
          if (check.fix) {
            console.log(`     → ${check.fix}`);
          }
          console.log("");
        }

        if (!result.ok) {
          process.exitCode = 1;
        }
      } catch (error) {
        logger.error({ error }, "Doctor failed");
        console.error(error instanceof Error ? error.message : "Doctor failed");
        process.exitCode = 1;
      }
    });

  program
    .command("prune")
    .description("Bound the raw payload archive. Never touches measurements or activities.")
    .option(
      "--days <number>",
      `Drop raw payloads older than this many days (default ${RAW_RETENTION_DAYS})`,
      String(RAW_RETENTION_DAYS)
    )
    .action(async (options: { days?: string }) => {
      try {
        const days = Number(options.days);
        if (!Number.isFinite(days) || days < 1) {
          console.error(`--days must be a positive number, got "${options.days}".`);
          process.exitCode = 1;
          return;
        }
        await runPrune(Math.floor(days));
      } catch (error) {
        logger.error({ error }, "Prune failed");
        console.error(error instanceof Error ? error.message : "Prune failed");
        process.exitCode = 1;
      }
    });

  program
    .command("status")
    .description("Show session and cache status")
    .action(async () => {
      try {
        await runStatus();
      } catch (error) {
        logger.error({ error }, "Failed to read status");
        process.exitCode = 1;
      }
    });

  return program;
}
