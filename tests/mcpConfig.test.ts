import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildTrainBudServerEntry,
  mergeTrainBudConfig,
  readMcpConfig,
  writeMcpConfig,
} from "../src/mcpConfig.js";

describe("mcpConfig", () => {
  it("builds a stdio server entry with normalized paths", () => {
    const entry = buildTrainBudServerEntry({
      email: "runner@example.com",
      password: "secret",
      distIndexPath: "C:\\Projects\\trainbud\\dist\\index.js",
    });

    assert.equal(entry.command, "node");
    assert.deepEqual(entry.args, ["C:/Projects/trainbud/dist/index.js", "start"]);
    assert.deepEqual(entry.env, {
      GARMIN_EMAIL: "runner@example.com",
      GARMIN_PASSWORD: "secret",
    });
  });

  it("merges trainbud into an existing MCP config without removing other servers", () => {
    const merged = mergeTrainBudConfig(
      {
        mcpServers: {
          existing: {
            command: "node",
            args: ["existing.js"],
          },
        },
      },
      {
        email: "runner@example.com",
        password: "secret",
        distIndexPath: "/tmp/trainbud/dist/index.js",
      }
    );

    assert.ok(merged.mcpServers.existing);
    assert.ok(merged.mcpServers["trainbud"]);
    assert.equal(merged.mcpServers["trainbud"]?.args?.[0], "/tmp/trainbud/dist/index.js");
  });

  it("reads and writes MCP config files", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-mcp-"));
    const configPath = path.join(tempDir, "mcp.json");

    writeMcpConfig(configPath, {
      mcpServers: {
        "trainbud": buildTrainBudServerEntry({
          email: "runner@example.com",
          password: "secret",
          distIndexPath: "/tmp/trainbud/dist/index.js",
        }),
      },
    });

    const parsed = readMcpConfig(configPath);
    assert.ok(parsed.mcpServers["trainbud"]);
  });
});
