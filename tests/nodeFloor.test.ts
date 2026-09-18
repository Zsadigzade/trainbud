import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The supported Node version is stated in seven places and nothing kept them
 * agreeing. They disagreed in a way that mattered: `engines` and the README
 * said 20 while `commander` required 22.12, and `better-sqlite3` published no
 * prebuilt binary below Node 22 at all -- so the advertised floor was one no
 * user could install on without a C++ toolchain, and on Windows not at all.
 *
 * Pinning them to each other is cheap. Working out why an install fails on
 * someone else's machine is not.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const read = (...segments: string[]): string =>
  fs.readFileSync(path.join(root, ...segments), "utf8");

function enginesMajor(): number {
  const pkg = JSON.parse(read("package.json")) as { engines?: { node?: string } };
  const declared = pkg.engines?.node;
  assert.ok(declared, "package.json declares no engines.node");

  const major = /(\d+)/.exec(declared)?.[1];
  assert.ok(major, `could not read a major version out of "${declared}"`);
  return Number(major);
}

describe("everything agrees on which Node this needs", () => {
  const expected = enginesMajor();

  it("has a floor at or above the first version with a prebuilt sqlite binary", () => {
    // better-sqlite3 publishes nothing below ABI 127. Below this, every install
    // compiles from source and Windows fails outright.
    assert.ok(expected >= 22, `engines.node is ${expected}, which has no prebuilt binary`);
  });

  it("matches .nvmrc", () => {
    assert.equal(Number(read(".nvmrc").trim()), expected);
  });

  it("matches both Docker stages", () => {
    const bases = [...read("Dockerfile").matchAll(/^FROM node:(\d+)/gm)].map((m) => Number(m[1]));

    assert.ok(bases.length >= 2, "expected a build stage and a runtime stage");
    for (const base of bases) {
      assert.equal(base, expected, "a Dockerfile stage is on a different Node");
    }
  });

  it("is the lowest version CI actually runs", () => {
    const ci = read(".github", "workflows", "ci.yml");
    const versions = [...ci.matchAll(/node-version: (?:\[([^\]]+)\]|(\d+))/g)].flatMap((match) =>
      (match[1] ?? match[2] ?? "").split(",").map((value) => Number(value.trim()))
    );

    assert.ok(versions.length > 0, "no node-version found in ci.yml");
    assert.equal(
      Math.min(...versions),
      expected,
      "CI never runs the oldest version the package claims to support"
    );
  });

  it("is what the README badge and QUICKSTART tell a reader", () => {
    // No trailing `-`: the badge may name the major alone or the exact floor
    // engines enforces (`>=22.12`), and the suite below requires the latter.
    // Pinning `${expected}-` here forbade the more precise of the two.
    assert.match(read("README.md"), new RegExp(`node-%3E%3D${expected}(?![0-9])`));
    assert.match(read("QUICKSTART.md"), new RegExp(`Node[.]js ${expected} or newer`));
  });
});

// The seven places above agree on the MAJOR, which is all `.nvmrc` and a
// `FROM node:22` can carry. `engines.node` is narrower than that -- 22.12.0,
// because commander needs it -- and the README advertised the major alone.
// Node 22.0 through 22.11 therefore read as supported and are refused by npm,
// which is the same shape as the floor that said 20: a version the docs invite
// and the package will not install on.
describe("the README states the floor npm actually enforces", () => {
  function enginesFloor(): string {
    const pkg = JSON.parse(read("package.json")) as { engines?: { node?: string } };
    const floor = /(\d+\.\d+\.\d+)/.exec(pkg.engines?.node ?? "")?.[1];
    assert.ok(floor, "engines.node carries no full version");
    return floor;
  }

  it("says the same version in prose as engines does", () => {
    const floor = enginesFloor();
    const minor = floor.replace(/\.0$/, ""); // 22.12.0 reads as "22.12" to a human
    const readme = read("README.md");

    // Plain containment rather than a built regex: "22.12+" turns into a
    // pattern where `.` matches anything and `+` means "one or more", so the
    // regex version of this assertion passed on strings like "Needs Node 22x12".
    assert.ok(
      readme.includes(`Needs Node ${minor}+`),
      `README should say "Needs Node ${minor}+", the version npm enforces, not the bare major`
    );
  });

  it("does not advertise a version npm would refuse", () => {
    const floor = enginesFloor();
    const [major, minor] = floor.split(".");
    // A badge reading ">=22" invites 22.0, which engines rejects.
    assert.doesNotMatch(
      read("README.md"),
      new RegExp(`node-%3E%3D${major}-`),
      `the badge offers ${major}.0, but engines requires ${major}.${minor}`
    );
  });
});
