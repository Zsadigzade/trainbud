import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listRegisteredToolNames } from "../src/tools/index.js";

/**
 * The README's tool table is the list a reader trusts, and nothing kept it
 * honest. Adding `compare_workouts` made three separate counts stale at once --
 * the table, "Fourteen tools" in the launch copy, and the directory blurb --
 * and none of them failed anything.
 *
 * A tool the README does not list is a tool nobody finds; a row for a tool that
 * no longer exists is worse, because someone will ask for it and get an error.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function toolNamesInReadmeTable(): string[] {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const start = readme.indexOf("## Tools");
  assert.notEqual(start, -1, "README has no ## Tools section");

  const rest = readme.slice(start + "## Tools".length);
  const end = rest.indexOf("\n## ");
  const section = end === -1 ? rest : rest.slice(0, end);

  return [...section.matchAll(/^\|\s*`([a-z0-9_]+)`\s*\|/gm)].map((match) => match[1]!);
}

describe("the README tool table and the registry agree", () => {
  it("lists every registered tool", () => {
    const listed = new Set(toolNamesInReadmeTable());
    const missing = listRegisteredToolNames().filter((name) => !listed.has(name));

    assert.deepEqual(missing, [], "registered but absent from the README table");
  });

  it("lists nothing that is not registered", () => {
    const registered = new Set(listRegisteredToolNames());
    const stale = toolNamesInReadmeTable().filter((name) => !registered.has(name));

    assert.deepEqual(stale, [], "in the README table but not registered");
  });
});

/**
 * The plugin ships the same list a second time, and it had rotted further: the
 * README knew about 14 tools while `plugin/skills/trainbud/SKILL.md` still said
 * "MCP tools (9)" and named nine. Six were invisible to anyone who installed the
 * plugin -- the path the README calls recommended -- including `get_findings`,
 * which is the one thing this product does that Connect does not.
 */
function toolNamesInPluginSkill(): string[] {
  const skill = fs.readFileSync(
    path.join(root, "plugin", "skills", "trainbud", "SKILL.md"),
    "utf8"
  );
  return [...skill.matchAll(/^\|\s*`([a-z0-9_]+)`\s*\|/gm)].map((match) => match[1]!);
}

describe("the plugin skill and the registry agree", () => {
  it("names every registered tool", () => {
    const listed = new Set(toolNamesInPluginSkill());
    const missing = listRegisteredToolNames().filter((name) => !listed.has(name));

    assert.deepEqual(missing, [], "registered but hidden from anyone using the plugin");
  });

  it("names nothing that is not registered", () => {
    const registered = new Set(listRegisteredToolNames());
    const stale = toolNamesInPluginSkill().filter((name) => !registered.has(name));

    assert.deepEqual(stale, []);
  });

  it("keeps the count in its own heading honest", () => {
    const skill = fs.readFileSync(
      path.join(root, "plugin", "skills", "trainbud", "SKILL.md"),
      "utf8"
    );
    const heading = /^## MCP tools \((\d+)\)/m.exec(skill);

    assert.ok(heading, "the skill has no '## MCP tools (N)' heading");
    assert.equal(
      Number(heading[1]),
      listRegisteredToolNames().length,
      "the heading counts a different number of tools than the registry holds"
    );
  });
});
