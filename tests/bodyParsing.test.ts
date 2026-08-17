import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFormOrJsonField } from "../src/httpServer.js";

// Regression guard for the pairing approval bug.
//
// The handler used to call readJsonBody(), which drains the request stream, and
// then on a JSON parse failure tried to read the stream a second time for
// URL-encoded data. By then it was empty, so `code` was always null and every
// form post answered "Missing code parameter" — dashboard pairing approval
// could never have succeeded. The body is now read once and parsed by shape.

describe("request body field extraction", () => {
  it("reads a URL-encoded field, as the dashboard form posts it", () => {
    assert.equal(readFormOrJsonField("code=395367", "code"), "395367");
  });

  it("reads a JSON field, as an API client posts it", () => {
    assert.equal(readFormOrJsonField('{"code":"395367"}', "code"), "395367");
  });

  it("tolerates leading whitespace before JSON", () => {
    assert.equal(readFormOrJsonField('  \n {"code":"1"}', "code"), "1");
  });

  it("reads one field out of several URL-encoded pairs", () => {
    assert.equal(readFormOrJsonField("other=x&code=42&more=y", "code"), "42");
  });

  it("decodes URL-encoded values", () => {
    assert.equal(
      readFormOrJsonField("anthropic_api_key=sk-ant-a%2Bb%2Fc", "anthropic_api_key"),
      "sk-ant-a+b/c"
    );
  });

  it("returns null for an empty body", () => {
    assert.equal(readFormOrJsonField("", "code"), null);
  });

  it("returns null when the field is absent", () => {
    assert.equal(readFormOrJsonField("other=1", "code"), null);
    assert.equal(readFormOrJsonField('{"other":"1"}', "code"), null);
  });

  it("returns null for malformed JSON rather than throwing", () => {
    assert.equal(readFormOrJsonField('{"code":', "code"), null);
  });

  it("returns null for a non-string JSON value", () => {
    assert.equal(readFormOrJsonField('{"code":395367}', "code"), null);
  });
});
