import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isClientAbortError } from "../src/httpServer.js";

/**
 * A client that hangs up mid-request is not a server fault, and the /mcp
 * handler used to record it as one: `logger.error({ error }, "HTTP MCP request
 * failed")` with the full `Error: aborted` stack, once per abandoned request.
 *
 * That is the ordinary end of a streaming MCP request -- a watch losing
 * Bluetooth, a browser tab closed, a tunnel dropping -- so it drowned the log
 * it shares with the failures worth reading. Measured on this machine's own
 * `.trainbud/mcp.log`: 712 of 795 error-level lines were this one event, with
 * the real ingest failures, the rejected API key and the Garmin auth retries
 * scattered among them. The troubleshooting docs point users at that file.
 *
 * The predicate is tested rather than the log file because pino's file
 * destination is async: a test that reads the file back passes whether or not
 * the fix is present, which is worse than no test at all.
 */
describe("telling a client hanging up apart from a server fault", () => {
  it("recognises the shape the live log actually recorded", () => {
    const aborted = Object.assign(new Error("aborted"), { code: "ECONNRESET" });

    assert.equal(isClientAbortError(aborted), true);
  });

  it("recognises the other ways a socket dies under us", () => {
    for (const [message, code] of [
      ["aborted", undefined],
      ["socket hang up", "ECONNRESET"],
      ["read ECONNABORTED", "ECONNABORTED"],
      ["Premature close", "ERR_STREAM_PREMATURE_CLOSE"],
      ["The operation was aborted", "ABORT_ERR"],
      ["write EPIPE", "EPIPE"],
    ] as const) {
      const error = Object.assign(new Error(message), code ? { code } : {});

      assert.equal(isClientAbortError(error), true, `${message} / ${code ?? "no code"}`);
    }
  });

  it("does not swallow a genuine server fault", () => {
    for (const error of [
      new Error("Cannot read properties of undefined (reading 'sleep')"),
      Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }),
      Object.assign(new Error("getaddrinfo ENOTFOUND connectapi.garmin.com"), {
        code: "ENOTFOUND",
      }),
      new TypeError("transport.handleRequest is not a function"),
    ]) {
      assert.equal(isClientAbortError(error), false, error.message);
    }
  });

  it("survives being handed something that is not an error at all", () => {
    for (const value of [undefined, null, "aborted", 42, {}, []]) {
      assert.doesNotThrow(() => isClientAbortError(value));
      assert.equal(isClientAbortError(value), false, JSON.stringify(value) ?? "undefined");
    }
  });
});
