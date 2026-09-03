// SECTION: Claiming stdout for the MCP protocol
//
// `trainbud start` runs StdioServerTransport on stdout. Every byte on that
// stream has to be JSON-RPC, and `console.log` writes to stdout.
//
// garmin-connect does this, at HttpClient.js:354:
//
//     console.log('login page title:', title);
//
// so any re-login inside a tool call injects two lines of English into the
// middle of the protocol stream and the client -- Claude Desktop, Cursor, the
// product's primary surface -- loses the session. The user sees the AI lose
// access to their data, which in this release has now had three distinct
// causes.
//
// `withQuietUpstreamErrors` in garmin/client.ts already existed for exactly
// this hazard and covered `console.error` only, scoped to the login call.
// Adding `console.log` beside it would have been the same fix in the same
// shape a fourth time, and it would still leave every other dependency, and
// every future one, able to reach stdout. A transport cannot be correct because
// today's libraries happen to be polite.
//
// So stdout is claimed for the lifetime of the process instead. `console.*`
// goes to stderr, where the logger already writes and where a person can still
// read it; the transport keeps writing to `process.stdout` directly, untouched.

type ConsoleMethod = "log" | "info" | "debug" | "dir";

const REDIRECTED: ConsoleMethod[] = ["log", "info", "debug", "dir"];

let original: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> | null = null;

/**
 * Send every console method that defaults to stdout to stderr instead.
 *
 * Idempotent: calling it twice must not capture the already-redirected
 * functions as the originals, or `restoreStdout` would restore the redirect and
 * make it permanent.
 */
export function protectStdout(): void {
  if (original) {
    return;
  }

  original = {};
  for (const method of REDIRECTED) {
    original[method] = console[method].bind(console) as (...args: unknown[]) => void;
    console[method] = (...args: unknown[]): void => {
      process.stderr.write(`${args.map(formatArgument).join(" ")}\n`);
    };
  }
}

export function restoreStdout(): void {
  if (!original) {
    return;
  }

  for (const method of REDIRECTED) {
    const restored = original[method];
    if (restored) {
      console[method] = restored as typeof console.log;
    }
  }

  original = null;
}

function formatArgument(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
