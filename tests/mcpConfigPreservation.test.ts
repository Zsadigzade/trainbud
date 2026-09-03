import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  configureTrainBudForClient,
  mergeTrainBudConfig,
  readMcpConfig,
} from "../src/mcpConfig.js";

// `trainbud setup` rewrote claude_desktop_config.json keeping `mcpServers` and
// nothing else.
//
//     return { mcpServers: parsed.mcpServers };
//
// Every other top-level key in the file -- globalShortcut, and whatever else
// Claude Desktop or a future version puts there -- was read, dropped, and the
// file written back without it. Worse, a config carrying no `mcpServers` key at
// all is perfectly valid, and that branch returned `{ mcpServers: {} }`, so the
// whole file was replaced.
//
// This is the command the documentation tells a user to run when something is
// wrong, which is exactly how `writeEnvFile` once deleted people's
// ANTHROPIC_API_KEY. Same command, same shape of loss, second time.

const CREDENTIALS = {
  email: "someone@example.test",
  password: "hunter2",
  distIndexPath: "C:/Users/x/Trainbud/dist/index.js",
};

/** A real-shaped Claude Desktop config: ours, a stranger's, and settings. */
const EXISTING = {
  globalShortcut: "Ctrl+Space",
  theme: "dark",
  mcpServers: {
    filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] },
    trainbud: { command: "node", args: ["/old/path/index.js", "start"] },
  },
};

describe("setup keeps the rest of the user's config", () => {
  let directory: string;
  let configPath: string;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-mcpcfg-"));
    configPath = path.join(directory, "claude_desktop_config.json");
    fs.writeFileSync(configPath, JSON.stringify(EXISTING, null, 2));
  });

  after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("reads every top-level key, not only mcpServers", () => {
    const config = readMcpConfig(configPath) as Record<string, unknown>;

    assert.equal(config.globalShortcut, "Ctrl+Space");
    assert.equal(config.theme, "dark");
  });

  it("carries those keys through the merge untouched", () => {
    const merged = mergeTrainBudConfig(readMcpConfig(configPath), CREDENTIALS) as Record<
      string,
      unknown
    >;

    assert.equal(merged.globalShortcut, "Ctrl+Space");
    assert.equal(merged.theme, "dark");
  });

  it("writes them back to disk, which is the only thing that matters", () => {
    configureTrainBudForClient(
      { id: "claude-desktop", label: "Claude Desktop", configPath },
      CREDENTIALS
    );

    const written = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;

    assert.equal(written.globalShortcut, "Ctrl+Space");
    assert.equal(written.theme, "dark");
  });

  it("leaves another tool's MCP server alone and updates only its own", () => {
    const written = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      mcpServers: Record<string, { command?: string; args?: string[] }>;
    };

    assert.ok(written.mcpServers.filesystem, "a stranger's server was dropped");
    assert.equal(written.mcpServers.filesystem?.command, "npx");
    assert.deepEqual(written.mcpServers.trainbud?.args, [CREDENTIALS.distIndexPath, "start"]);
  });

  it("backs the file up before overwriting it", () => {
    const backup = path.join(directory, "claude_desktop_config.bak.json");

    assert.ok(fs.existsSync(backup), "no backup was written");
    const saved = JSON.parse(fs.readFileSync(backup, "utf8")) as Record<string, unknown>;
    assert.equal(saved.globalShortcut, "Ctrl+Space");
    // It carries GARMIN_PASSWORD in an env block once written, so it is as
    // sensitive as the original and gets the same permissions.
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
    }
  });
});

describe("a config with no mcpServers key is still the user's config", () => {
  let directory: string;
  let configPath: string;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-mcpcfg-bare-"));
    configPath = path.join(directory, "claude_desktop_config.json");
    // Entirely valid, and the old `!parsed.mcpServers` branch discarded it.
    fs.writeFileSync(configPath, JSON.stringify({ globalShortcut: "Ctrl+Q" }, null, 2));
  });

  after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("does not throw the whole file away to add one server", () => {
    configureTrainBudForClient(
      { id: "claude-desktop", label: "Claude Desktop", configPath },
      CREDENTIALS
    );

    const written = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;

    assert.equal(written.globalShortcut, "Ctrl+Q");
    assert.ok((written.mcpServers as Record<string, unknown>).trainbud);
  });
});
