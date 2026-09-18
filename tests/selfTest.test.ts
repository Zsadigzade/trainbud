import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkState, probePublicUrl } from "../src/selfTest.js";

// The reported bug, as a test.
//
// A watch showed "AI Unavailable, Error HTTP -400". The server was healthy, the
// watch was healthy and the AI was healthy; the tunnel was down, so ngrok
// answered an HTML error page under a 404, Connect IQ could not parse it as
// JSON, and the watch reported -400. Every diagnostic in the project ran on the
// server and therefore said everything was fine.
//
// probePublicUrl exists to make that hop testable, and these cases are the
// bodies that have actually been served to this app's watch in the wild.

function response(
  body: string,
  init: { status?: number; contentType?: string } = {}
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": init.contentType ?? "application/json" },
  });
}

function fetchReturning(value: Response | Error): typeof fetch {
  return (async () => {
    if (value instanceof Error) {
      throw value;
    }
    return value;
  }) as unknown as typeof fetch;
}

describe("public URL probe", () => {
  it("passes only when the body is TrainBud's own JSON", async () => {
    const outcome = await probePublicUrl(
      "https://example.test",
      fetchReturning(response(JSON.stringify({ status: "ok", service: "trainbud" })))
    );

    assert.equal(outcome.reach, "ok");
    assert.equal(outcome.status, 200);
  });

  it("calls a dead ngrok tunnel what it is, not a healthy 404", async () => {
    // The exact shape that produced the report: an HTML error page under a 404.
    const outcome = await probePublicUrl(
      "https://example.ngrok-free.dev",
      fetchReturning(
        response("<!DOCTYPE html><html><body>ERR_NGROK_3200 endpoint is offline</body></html>", {
          status: 404,
          contentType: "text/html",
        })
      )
    );

    assert.equal(outcome.reach, "not_server");
    assert.match(outcome.bodyStart, /ERR_NGROK_3200/);
  });

  it("fails a 200 that carries HTML, because the watch fails to PARSE it", async () => {
    // ngrok's free tier answered browser-UA GETs with an interstitial under a
    // 200 for two days while every status check reported the server healthy.
    // Grading the status code alone would call this a pass.
    const outcome = await probePublicUrl(
      "https://example.ngrok-free.dev",
      fetchReturning(
        response("<html><body>You are about to visit...</body></html>", {
          status: 200,
          contentType: "text/html",
        })
      )
    );

    assert.equal(outcome.reach, "not_server");
  });

  it("fails valid JSON that is not this service", async () => {
    const outcome = await probePublicUrl(
      "https://example.test",
      fetchReturning(response(JSON.stringify({ status: "ok", service: "something-else" })))
    );

    assert.equal(outcome.reach, "not_server");
  });

  it("separates a credential problem from an unreachable host", async () => {
    const unauthorized = await probePublicUrl(
      "https://example.test",
      fetchReturning(response("nope", { status: 401, contentType: "text/plain" }))
    );
    assert.equal(unauthorized.reach, "unauthorized");

    const refused = await probePublicUrl(
      "https://example.test",
      fetchReturning(response("slow down", { status: 429, contentType: "text/plain" }))
    );
    assert.equal(refused.reach, "refused");

    const down = await probePublicUrl(
      "https://example.test",
      fetchReturning(new Error("getaddrinfo ENOTFOUND example.test"))
    );
    assert.equal(down.reach, "unreachable");
    assert.match(down.error ?? "", /ENOTFOUND/);
  });

  it("treats a 5xx as unreachable rather than as a wrong server", async () => {
    const outcome = await probePublicUrl(
      "https://example.test",
      fetchReturning(response("upstream is down", { status: 502, contentType: "text/html" }))
    );

    assert.equal(outcome.reach, "unreachable");
  });

  it("probes /health under the base URL, with the watch's own headers", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};

    const spy = (async (url: string, init: RequestInit) => {
      seenUrl = url;
      seenHeaders = (init.headers ?? {}) as Record<string, string>;
      return response(JSON.stringify({ status: "ok", service: "trainbud" }));
    }) as unknown as typeof fetch;

    // Trailing slash included on purpose: a doubled slash is exactly the kind of
    // difference that makes a probe pass where the real client fails.
    await probePublicUrl("https://example.test/", spy);

    assert.equal(seenUrl, "https://example.test/health");
    // Connect IQ sends Mozilla/5.0 and will not let an app override it, which is
    // why ngrok answered the watch with HTML while curl got JSON. A probe that
    // does not impersonate the watch tests the wrong client.
    assert.equal(seenHeaders["User-Agent"], "Mozilla/5.0");
    assert.equal(seenHeaders["ngrok-skip-browser-warning"], "1");
  });
});

/**
 * `doctor` read `coverage.days` and applied its own `>= 14`, ignoring the
 * `ready` flag that exists precisely because a deep store can still be stale.
 * On 2026-09-03, against a store holding 74 days that stopped on 08-21, it
 * printed "enough to compare a day against your own baselines" — the one
 * command whose job is to report what is wrong, reporting that nothing was.
 */
describe("what doctor says about the history it has", () => {
  it("does not call a deep but stale store healthy", async () => {
    const { describeHistoryCoverage } = await import("../src/selfTest.js");

    const line = describeHistoryCoverage({
      days: 74,
      ready: false,
      throughDate: "2026-08-21",
      staleDays: 13,
    });

    assert.equal(line.ok, false, "a store 13 days behind is not a passing check");
    assert.match(line.detail, /stops at 2026-08-21/);
    assert.match(line.detail, /13 days ago/);
    assert.match(line.fix ?? "", /backfill/);
  });

  it("passes a store that is both deep and current", async () => {
    const { describeHistoryCoverage } = await import("../src/selfTest.js");

    const line = describeHistoryCoverage({
      days: 74,
      ready: true,
      throughDate: "2026-09-03",
      staleDays: 0,
    });

    assert.equal(line.ok, true);
    assert.equal(line.fix, undefined);
  });

  it("still tells a new user they need more days, not that they are behind", async () => {
    const { describeHistoryCoverage } = await import("../src/selfTest.js");

    const line = describeHistoryCoverage({
      days: 3,
      ready: false,
      throughDate: "2026-09-03",
      staleDays: 0,
    });

    assert.equal(line.ok, false);
    assert.match(line.detail, /14 are needed/);
    assert.doesNotMatch(line.detail, /stops at/);
  });
});

// A check has three states and the drawing code could only ever produce two.
// Both surfaces asked `ok` first: `check.ok ? "✓" : check.warning ? "!" : "✗"`
// in the CLI and the same shape in the dashboard. Every warning runSelfTest
// builds sets ok AND warning, so it drew as a plain tick reading "ok" -- the
// `!` glyph and the dashboard's `warn` class were unreachable code.
describe("which state a check is drawn in", () => {
  it("draws a warning as a warning even though the check passed", () => {
    // This is the shape every warning in this file actually has, including the
    // pairing check that has shipped since 0.5.2.
    assert.equal(checkState({ name: "Pairing", ok: true, warning: true, detail: "" }), "warning");
  });

  it("draws a warning as a warning when the check also failed", () => {
    // Not enough history yet: `ok` is false because no detector can run, but
    // waiting is the fix, and "✗ History depth" reads as something broken.
    assert.equal(checkState({ name: "History depth", ok: false, warning: true, detail: "" }), "warning");
  });

  it("leaves a plain pass and a plain failure alone", () => {
    assert.equal(checkState({ name: "Public URL", ok: true, detail: "" }), "ok");
    assert.equal(checkState({ name: "Public URL", ok: false, detail: "" }), "failed");
    assert.equal(checkState({ name: "Public URL", ok: true, warning: false, detail: "" }), "ok");
  });

  it("does not change what decides the exit code", () => {
    // `ok` is still the field runSelfTest reduces over. A warning that passed
    // must not start failing `trainbud doctor`.
    const checks = [
      { name: "a", ok: true, warning: true, detail: "" },
      { name: "b", ok: true, detail: "" },
    ];
    assert.equal(checks.every((check) => check.ok), true);
  });
});
