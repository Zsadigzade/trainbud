import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureLogger, logger } from "../src/utils/logger.js";

// The server's error log recorded that things failed and never once recorded
// why.
//
// pino applies its built-in Error serializer to the key `err` and to nothing
// else. This codebase logs `{ error }` in twenty places, and an Error has no
// enumerable own properties, so every one of them wrote `"error":{}`. The line
// that existed to preserve the cause was the line throwing it away.
//
// Found by reading a real log after "History catch-up failed" and being unable
// to tell what had failed.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-log-"));
const logPath = path.join(tmpDir, "server.log");

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** pino writes asynchronously; give it a tick to reach the file. */
async function readLogLines(): Promise<Record<string, unknown>[]> {
  await new Promise((resolve) => setTimeout(resolve, 150));
  return fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("error logging", () => {
  it("records the message and stack under both spellings", async () => {
    configureLogger(logPath);

    logger.warn({ error: new Error("the real reason") }, "logged as error");
    logger.warn({ err: new Error("also the real reason") }, "logged as err");

    const lines = await readLogLines();

    const asError = lines.find((line) => line["msg"] === "logged as error");
    const asErr = lines.find((line) => line["msg"] === "logged as err");

    assert.ok(asError, "the error-keyed line never reached the log");
    assert.ok(asErr, "the err-keyed line never reached the log");

    const errorField = asError["error"] as { message?: string; stack?: string };
    assert.equal(
      errorField?.message,
      "the real reason",
      'an Error logged under "error" serialised to nothing'
    );
    assert.ok(errorField?.stack, "no stack was recorded");

    const errField = asErr["err"] as { message?: string };
    assert.equal(errField?.message, "also the real reason");
  });

  it("still logs a plain object under either key", async () => {
    configureLogger(logPath);
    logger.warn({ error: { code: "ENOENT" } }, "not an Error");

    const line = (await readLogLines()).find((entry) => entry["msg"] === "not an Error");
    assert.deepEqual(line?.["error"], { code: "ENOENT" });
  });
});
