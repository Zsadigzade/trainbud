import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJsonFile, stripBom } from "../src/utils/jsonFile.js";

/**
 * `.trainbud/watch-setup.json` held the correct tunnel URL and the server
 * reported "No public URL is configured" for it, because PowerShell 5.1's
 * `Set-Content -Encoding utf8` prefixes a BOM and JSON.parse rejects it. The
 * tunnel was up and answering 200 the whole time.
 */
describe("reading JSON a Windows tool wrote", () => {
  it("parses a file with a UTF-8 byte order mark", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-bom-"));
    const file = path.join(dir, "watch-setup.json");
    try {
      fs.writeFileSync(
        file,
        Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]),
          Buffer.from(JSON.stringify({ serverUrl: "https://example.ngrok-free.dev" }), "utf8"),
        ])
      );

      assert.throws(
        () => JSON.parse(fs.readFileSync(file, "utf8")),
        "the plain read this replaced really does fail on these bytes"
      );

      const parsed = readJsonFile<{ serverUrl: string }>(file);
      assert.equal(parsed.serverUrl, "https://example.ngrok-free.dev");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves a file with no mark untouched", () => {
    assert.equal(stripBom('{"a":1}'), '{"a":1}');
  });

  it("strips only one mark, and only at the start", () => {
    assert.equal(stripBom("\uFEFF\uFEFFx"), "\uFEFFx");
    assert.equal(stripBom("x\uFEFF"), "x\uFEFF");
  });
});
