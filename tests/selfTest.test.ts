import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { probePublicUrl } from "../src/selfTest.js";

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
