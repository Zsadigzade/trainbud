import fs from "node:fs";
import path from "node:path";
import pino from "pino";
import type { Logger } from "pino";
import { appConfig } from "../config.js";

let loggerInstance: Logger | null = null;

/**
 * pino.transport() runs pino-pretty in a worker thread, and a live worker keeps
 * the Node event loop open. Nothing here ever closes the logger, so a process
 * whose only remaining handle was the transport -- `node --test`, a CI step,
 * any short-lived command -- would sometimes finish all its work and then hang
 * until something killed it. It was intermittent because it depended on whether
 * the worker had wound down on its own by the time the last test ended.
 *
 * Colour and column alignment are only worth anything on an attached terminal.
 * Everywhere else, write plain NDJSON straight to fd 2 with no worker at all.
 */
function prettyStderrStream(): pino.DestinationStream {
  if (!process.stderr.isTTY) {
    return pino.destination(2);
  }

  return pino.transport({
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      destination: 2,
    },
  });
}

/**
 * Shared options, and the reason this file has any.
 *
 * pino applies its built-in Error serializer to the key `err` and to nothing
 * else. This codebase logs `{ error }` in twenty places and `{ err }` in three,
 * and an Error has no enumerable own properties -- so twenty of those wrote
 * literally `"error":{}` to the log file. The server's error log recorded that
 * something failed and never once recorded why.
 *
 * Found by reading the log after "History catch-up failed" and discovering the
 * cause had been thrown away by the line that was supposed to preserve it. That
 * is the same fault as the rest of this release: a diagnostic that names
 * nothing. Both keys are now serialized, so neither spelling loses the message
 * or the stack.
 */
function baseOptions(): pino.LoggerOptions {
  return {
    level: process.env.LOG_LEVEL ?? "info",
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
  };
}

function createStderrLogger(): Logger {
  return pino(baseOptions(), prettyStderrStream());
}

function createFileLogger(logPath: string): Logger {
  const directory = path.dirname(logPath);
  fs.mkdirSync(directory, { recursive: true });

  return pino(
    baseOptions(),
    pino.multistream([
      {
        stream: pino.destination({
          dest: logPath,
          sync: false,
          mkdir: true,
        }),
      },
      {
        stream: prettyStderrStream(),
      },
    ])
  );
}

function getLogger(): Logger {
  if (!loggerInstance) {
    loggerInstance = createStderrLogger();
  }
  return loggerInstance;
}

export function configureLogger(logPath = appConfig.logPath): void {
  loggerInstance = createFileLogger(logPath);
}

export const logger: Logger = new Proxy({} as Logger, {
  get(_target, property, receiver) {
    const instance = getLogger();
    const value = Reflect.get(instance, property, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
