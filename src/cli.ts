import { Command } from "commander";
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
import { runIngest } from "./history/ingest.js";
import { startHistoryScheduler } from "./history/scheduler.js";
import { closeHistoryDb, historyStats } from "./history/store.js";
import type { IngestSource } from "./history/schema.js";
import { printLiveCheckResults, runLiveCheck } from "./check.js";

// SECTION: Bootstrap
//
// Runs before every command. Moves pre-0.3.0 state out of `.garmin/` and warns
// once about renamed environment variables, so an existing install keeps its
// session, cache and watch pairing across the rename.

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
  closeHistoryDb();
}

const INGEST_SOURCES: IngestSource[] = [
  "sleep",
  "heart_rate",
  "stress",
  "vo2max",
  "body_composition",
];

async function runBackfill(options: {
  days?: number;
  delayMs?: number;
  source?: string[];
}): Promise<void> {
  assertGarminCredentials();

  const sources = options.source?.length
    ? options.source.map((name) => {
        if (!INGEST_SOURCES.includes(name as IngestSource)) {
          throw new Error(
            `Unknown source "${name}". Choose from: ${INGEST_SOURCES.join(", ")}`
          );
        }
        return name as IngestSource;
      })
    : INGEST_SOURCES;

  const days = options.days ?? 365;
  const delayMs = options.delayMs ?? 1000;

  console.log(
    `Backfilling ${days} days from ${sources.length} sources, ${delayMs}ms apart.`
  );
  console.log("Safe to interrupt — every day is checkpointed and the next run resumes.");
  console.log("");

  const result = await withGarminClient(async (client) =>
    runIngest(client, {
      days,
      delayMs,
      sources,
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
  if (result.errors > 0) {
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
    .option("-p, --port <number>", "HTTP port", (value) => Number.parseInt(value, 10))
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
    .option("-d, --days <number>", "How many days back to fetch", (value) => Number.parseInt(value, 10))
    .option("--delay-ms <number>", "Delay between requests", (value) => Number.parseInt(value, 10))
    .option(
      "-s, --source <name>",
      "Limit to one source (repeatable)",
      (value: string, previous: string[] = []) => [...previous, value]
    )
    .action(async (options: { days?: number; delayMs?: number; source?: string[] }) => {
      try {
        await runBackfill(options);
      } catch (error) {
        logger.error({ error }, "Backfill failed");
        console.error(error instanceof Error ? error.message : "Backfill failed");
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
        logger.error({ error }, "Live check failed");
        console.error(error instanceof Error ? error.message : "Live check failed");
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
