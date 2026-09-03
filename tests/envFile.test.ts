import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse } from "dotenv";
import { quoteEnvValue, carriedEnvLines } from "../src/config.js";

// Two ways `trainbud setup` could quietly ruin an install.
//
// It writes .env, and it is the command the setup guide tells a user to run
// when something is wrong -- so both of these bite hardest at exactly the moment
// the user is already confused.

describe("env value quoting", () => {
  const roundTrip = (value: string): string | undefined =>
    parse(`P=${quoteEnvValue(value)}`)["P"];

  it("survives a hash, which unquoted is a comment", () => {
    // Measured, not assumed: `P=pa#ss` parses back as `pa`. A Garmin password
    // containing a hash was silently truncated at that character, so setup
    // reported success and every login afterwards failed with credentials the
    // user could see were correct.
    assert.equal(parse("P=pa#ss")["P"], "pa");
    assert.equal(roundTrip("pa#ss"), "pa#ss");
  });

  it("survives quotes, spaces, dollars and backslashes", () => {
    for (const value of [
      'pa"ss',
      "pa'ss",
      "pa ss",
      "pa$ss",
      "pa\\ss",
      "p#a'b\\c d$e",
    ]) {
      assert.equal(roundTrip(value), value, `round trip failed for ${JSON.stringify(value)}`);
    }
  });

  it("refuses a value it cannot represent rather than corrupting it", () => {
    // dotenv has no escape that works inside either quote style, so a value
    // containing both is unrepresentable. Saying so beats writing a file that
    // reads back as something else.
    assert.throws(() => quoteEnvValue(`pa'"ss`), /cannot be stored/);
  });
});

describe("carrying an existing .env across setup", () => {
  it("keeps the keys setup does not manage", () => {
    // writeEnvFile rebuilt the file from a fixed template, so re-running setup
    // deleted the Anthropic key and the public URL outright.
    const existing = [
      "GARMIN_EMAIL=old@example.com",
      "GARMIN_PASSWORD=old",
      "TRAINBUD_API_KEY=abc",
      "ANTHROPIC_API_KEY=sk-ant-keepme",
      "TRAINBUD_PUBLIC_URL=https://tunnel.example.com",
      "MY_OWN_THING=42",
    ].join("\n");

    const carried = carriedEnvLines(existing);

    assert.ok(carried.includes("ANTHROPIC_API_KEY=sk-ant-keepme"));
    assert.ok(carried.includes("TRAINBUD_PUBLIC_URL=https://tunnel.example.com"));
    assert.ok(carried.includes("MY_OWN_THING=42"));
  });

  it("does not carry the keys setup rewrites, under either name", () => {
    const existing = [
      "GARMIN_EMAIL=a@b.c",
      "GARMIN_PASSWORD=x",
      "TRAINBUD_API_KEY=new",
      "GARMIN_MCP_API_KEY=old",
      "CACHE_TTL_SLEEP=7200",
    ].join("\n");

    assert.deepEqual(carriedEnvLines(existing), []);
  });

  it("ignores comments and blank lines", () => {
    const existing = ["# a comment", "", "   ", "# ANTHROPIC_API_KEY=commented-out"].join("\n");
    assert.deepEqual(carriedEnvLines(existing), []);
  });

  it("keeps an exported assignment", () => {
    assert.deepEqual(carriedEnvLines("export MY_THING=1"), ["export MY_THING=1"]);
  });
});
