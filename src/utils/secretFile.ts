import fs from "node:fs";
import path from "node:path";

// SECTION: Secret files on disk
//
// Three files this server writes are credentials in the clear: `.env` (the
// Connect password and the API key), `.trainbud/session.json` (live OAuth
// tokens for the Connect account) and the MCP client config (the same Connect
// password, written into an editor's config directory). All three were written
// with writeFileSync's default mode, so on Linux and macOS they landed as 0644
// and every other account on the machine could read them.
//
// The chmod is not redundant: writeFileSync applies `mode` when it creates a
// file, not when it truncates an existing one, so a file written by an earlier
// version keeps its old permissions forever without it.

const OWNER_ONLY = 0o600;

export function writeSecretFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, { encoding: "utf8", mode: OWNER_ONLY });

  // Windows has no POSIX bits and chmod there is a no-op at best.
  if (process.platform !== "win32") {
    fs.chmodSync(filePath, OWNER_ONLY);
  }
}

/**
 * Tighten a file this process did not write itself.
 *
 * `.trainbud/app.db` is created by better-sqlite3, not by writeSecretFile, so it
 * missed the hardening the other three credential files got -- and it holds the
 * Anthropic API key the dashboard saves, in the clear, in a table. It landed
 * 0644 like every other SQLite file, readable by every account on the machine.
 *
 * Silent on failure on purpose: a database that cannot be chmod'ed is still a
 * working database, and refusing to start over a permission bit would be a
 * worse outcome than the bit.
 */
export function restrictExistingFile(filePath: string): void {
  if (process.platform === "win32") {
    return;
  }
  try {
    fs.chmodSync(filePath, OWNER_ONLY);
  } catch {
    // Nothing useful to do: the data still works, the bits do not.
  }
}
