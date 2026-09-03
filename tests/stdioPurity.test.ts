import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { protectStdout, restoreStdout } from "../src/utils/stdio.js";

// Found by running the tools rather than by reading them.
//
// Verifying the store fallback against the live install printed this, twice,
// interleaved with the tool output:
//
//     login page title: GARMIN Authentication Application
//
// It is `console.log` at garmin-connect's HttpClient.js:354, and `console.log`
// writes to STDOUT. `trainbud start` runs StdioServerTransport on stdout, which
// is the MCP channel: every byte on it must be JSON-RPC. So any re-login inside
// a tool call injects two lines of prose into the middle of the protocol
// stream, and Claude Desktop and Cursor -- the product's primary surface --
// lose the connection.
//
// Which the user sees as the AI losing access to their data. Third distinct
// cause of that one report in one release.
//
// `withQuietUpstreamErrors` in garmin/client.ts already existed for precisely
// this, and covered `console.error` only. Patching one more method there would
// have been the same mistake a fourth time: the transport cannot be safe
// because today's dependencies happen to be polite. Stdout is claimed for the
// duration of the process, so no library reaching it can corrupt the protocol.

function captured(run: () => void): { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];

  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = ((chunk: string) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => {
    err.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;

  try {
    run();
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
    restoreStdout();
  }

  return { out, err };
}

describe("stdout belongs to the MCP protocol", () => {
  it("keeps a dependency's console.log off stdout", () => {
    const { out, err } = captured(() => {
      protectStdout();
      // Exactly what garmin-connect does on a re-login.
      console.log("login page title:", "GARMIN Authentication Application");
    });

    assert.equal(out.join(""), "", "nothing may reach stdout while the transport owns it");
    assert.match(err.join(""), /login page title/);
  });

  it("covers every console method that defaults to stdout", () => {
    const { out } = captured(() => {
      protectStdout();
      console.log("log");
      console.info("info");
      console.debug("debug");
      console.dir({ a: 1 });
    });

    assert.equal(out.join(""), "");
  });

  it("leaves a direct process.stdout.write alone, which is how the transport writes", () => {
    const { out } = captured(() => {
      protectStdout();
      process.stdout.write('{"jsonrpc":"2.0"}\n');
    });

    assert.equal(out.join(""), '{"jsonrpc":"2.0"}\n');
  });

  it("restores the real console, so the CLI still prints where a user can see it", () => {
    const { out } = captured(() => {
      protectStdout();
      restoreStdout();
      console.log("back on stdout");
    });

    assert.match(out.join(""), /back on stdout/);
  });

  it("is idempotent, so a second call cannot make stderr the permanent target", () => {
    const { out, err } = captured(() => {
      protectStdout();
      protectStdout();
      restoreStdout();
      console.log("back on stdout");
    });

    assert.match(out.join(""), /back on stdout/);
    assert.equal(err.join(""), "");
  });
});
