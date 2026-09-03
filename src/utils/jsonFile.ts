import fs from "node:fs";

/**
 * Windows PowerShell 5.1's `Set-Content -Encoding utf8` writes a BOM, and
 * `JSON.parse` treats a leading U+FEFF as a syntax error. Every JSON file this
 * project reads can have been written or edited by a Windows tool: the watch
 * setup file is written by `scripts/start-watch-stack.ps1`, and Claude Desktop
 * and Cursor both ship BOM'd config on Windows.
 *
 * This was not theoretical. `.trainbud/watch-setup.json` held the correct
 * tunnel URL, and `appConfig.publicUrl` returned "" for it, because the parse
 * threw on the BOM and the getter's `catch` swallowed the reason. `trainbud
 * doctor` then reported "No public URL is configured, so the watch has no
 * address to call" while the tunnel was up and answering 200 — a diagnostic
 * naming the wrong fault, about the one file whose whole job is to name an
 * address.
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Read and parse a JSON file, tolerating a byte order mark. Throws like JSON.parse. */
export function readJsonFile<T>(filePath: string): T {
  return JSON.parse(stripBom(fs.readFileSync(filePath, "utf8"))) as T;
}
