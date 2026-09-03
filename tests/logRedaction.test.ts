import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactRequestUrl } from "../src/httpServer.js";

// The dashboard authenticates with `?token=<the API key>`, so any code path
// that writes a raw request URL to the log writes a live credential to
// `.trainbud/mcp.log`.
//
// The request-logging line was fixed for this and goes through
// redactPath + redactQuery. The unhandled-error handler four hundred lines
// below did not:
//
//     logger.error({ error, url: req.url }, "Unhandled error in request handler")
//
// Same file, same log, same key, one fix short -- the sibling pattern this
// project keeps paying for. Measured: `.trainbud/mcp.log` on this machine
// contains the live key in plaintext on the line that predates the first fix.
//
// This takes the RAW `req.url`, which is a path with a query and not an
// absolute URL, so it cannot go through `new URL()` without a base and must not
// throw on a malformed one -- the whole point of that handler is that nothing
// inside it may take the process down.

describe("nothing writes a credential to the log", () => {
  it("redacts the dashboard token out of a raw request url", () => {
    const redacted = redactRequestUrl("/dashboard?token=5fb2c90c292f53fd75fca033edb7e48b");

    assert.doesNotMatch(redacted, /5fb2c90c/);
    assert.match(redacted, /<redacted>/);
    assert.match(redacted, /^\/dashboard/);
  });

  it("redacts every credential-shaped parameter, not only token", () => {
    for (const name of ["token", "api_key", "apikey", "key", "secret", "password"]) {
      const redacted = redactRequestUrl(`/x?${name}=supersecretvalue`);
      assert.doesNotMatch(redacted, /supersecretvalue/, `${name} leaked`);
    }
  });

  it("redacts a live pairing code out of the path", () => {
    // A pair code is a bearer credential for five minutes:
    // /api/pair/<code>/status hands out the API key once approved.
    const redacted = redactRequestUrl("/api/pair/418902/status");

    assert.doesNotMatch(redacted, /418902/);
    assert.match(redacted, /<code>/);
  });

  it("keeps the parts worth having, which is why the line exists", () => {
    const redacted = redactRequestUrl("/api/watch?since=2026-09-03&format=json");

    assert.match(redacted, /\/api\/watch/);
    assert.match(redacted, /since=2026-09-03/);
  });

  it("survives a malformed url rather than throwing inside the crash handler", () => {
    for (const raw of ["", "%", "//", "http://[", "/x?%%%", undefined]) {
      assert.doesNotThrow(() => redactRequestUrl(raw));
    }
  });
});
