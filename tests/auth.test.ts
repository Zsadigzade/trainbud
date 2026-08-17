import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clearStoredSession,
  readStoredSession,
  sessionExists,
  writeStoredSession,
} from "../src/garmin/auth.js";

describe("auth session persistence", () => {
  let tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-auth-"));
  const previousSessionPath = process.env.TRAINBUD_SESSION_PATH;

  function sessionPath(): string {
    return path.join(tempDir, "session.json");
  }

  afterEach(() => {
    if (previousSessionPath === undefined) {
      delete process.env.TRAINBUD_SESSION_PATH;
    } else {
      process.env.TRAINBUD_SESSION_PATH = previousSessionPath;
    }

    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trainbud-auth-"));
  });

  it("writes and reads a stored session", () => {
    process.env.TRAINBUD_SESSION_PATH = sessionPath();

    writeStoredSession({
      oauth1: {
        oauth_token: "token",
        oauth_token_secret: "secret",
      },
      oauth2: {
        scope: "scope",
        jti: "jti",
        access_token: "access",
        token_type: "bearer",
        refresh_token: "refresh",
        expires_in: 3600,
        expires_at: Date.now() + 3600000,
        refresh_token_expires_in: 3600,
        refresh_token_expires_at: Date.now() + 3600000,
      },
    });

    assert.equal(sessionExists(), true);

    const session = readStoredSession();
    assert.equal(session?.oauth1.oauth_token, "token");
    assert.equal(session?.oauth2.access_token, "access");
  });

  it("clears a stored session", () => {
    process.env.TRAINBUD_SESSION_PATH = sessionPath();

    writeStoredSession({
      oauth1: {
        oauth_token: "token",
        oauth_token_secret: "secret",
      },
      oauth2: {
        scope: "scope",
        jti: "jti",
        access_token: "access",
        token_type: "bearer",
        refresh_token: "refresh",
        expires_in: 3600,
        expires_at: Date.now() + 3600000,
        refresh_token_expires_in: 3600,
        refresh_token_expires_at: Date.now() + 3600000,
      },
    });

    clearStoredSession();
    assert.equal(sessionExists(), false);
    assert.equal(readStoredSession(), null);
  });
});
