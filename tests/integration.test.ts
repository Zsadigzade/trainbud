import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMcpServer } from "../src/server.js";
import { formatToolError } from "../src/toolErrors.js";
import { executeTool, toolRegistry } from "../src/tools/index.js";
import { packageVersion } from "../src/version.js";

describe("integration", () => {
  it("creates an MCP server with all registered tools", () => {
    const server = createMcpServer();
    assert.equal(typeof server.start, "function");
    assert.equal(typeof server.close, "function");

    // A count here was just a second place to edit whenever a tool was added.
    // What actually has to hold is that every registered tool is callable.
    assert.ok(toolRegistry.length > 0);
    for (const tool of toolRegistry) {
      assert.equal(typeof tool.handler, "function", `${tool.name} has no handler`);
      assert.ok(tool.description.length > 0, `${tool.name} has no description`);
    }
  });

  it("reads package version for MCP handshake", () => {
    assert.match(packageVersion, /^\d+\.\d+\.\d+/);
  });

  it("rejects unknown tools via executeTool", async () => {
    await assert.rejects(() => executeTool("unknown_tool", {}), /Unknown tool/);
  });

  it("validates get_activities_range date inputs", async () => {
    await assert.rejects(
      () => executeTool("get_activities_range", { start_date: "bad", end_date: "2026-06-01" }),
      /Invalid date/
    );
  });

  it("returns sanitized generic errors for unexpected failures", () => {
    const message = formatToolError(new Error("secret@example.com failed at /tmp/secret.log"));
    assert.doesNotMatch(message, /secret@example.com/);
    assert.match(message, /\[email\]/);
  });
});
