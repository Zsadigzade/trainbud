import fs from "node:fs";
import path from "node:path";
import type { GarminConnectInstance } from "./garminConnect.js";
import { GarminConnect } from "./garminConnect.js";
import { appConfig, assertGarminCredentials } from "../config.js";
import { logger } from "../utils/logger.js";
import { readJsonFile } from "../utils/jsonFile.js";
import { writeSecretFile } from "../utils/secretFile.js";
import type { StoredSession } from "./types.js";
import {
  clearAuthCooldown,
  credentialFingerprint,
  describeWait,
  nextCooldownState,
  readAuthCooldown,
  remainingCooldownMs,
  writeAuthCooldown,
} from "./authCooldown.js";

// SECTION: Session Persistence

export function sessionDirectory(): string {
  return path.dirname(appConfig.sessionPath);
}

export function sessionExists(): boolean {
  return fs.existsSync(appConfig.sessionPath);
}

export function readStoredSession(): StoredSession | null {
  const sessionPath = appConfig.sessionPath;

  if (!fs.existsSync(sessionPath)) {
    return null;
  }

  try {
    const parsed = readJsonFile<StoredSession>(sessionPath);

    if (!parsed.oauth1 || !parsed.oauth2) {
      return null;
    }

    return parsed;
  } catch (error) {
    logger.warn({ error }, "Failed to read stored Garmin session");
    return null;
  }
}

export function writeStoredSession(session: StoredSession): void {
  // Live OAuth tokens for the Connect account -- owner-readable only.
  writeSecretFile(appConfig.sessionPath, JSON.stringify(session, null, 2));
}

export function clearStoredSession(): void {
  const sessionPath = appConfig.sessionPath;
  if (fs.existsSync(sessionPath)) {
    fs.unlinkSync(sessionPath);
  }
}

// SECTION: Authentication

/**
 * A sign-in that was refused locally, before any request was made.
 *
 * Distinct from a genuine authentication failure because the two want opposite
 * responses: an authentication failure means "check your password", and this
 * means "your password is already known to be wrong, stop asking Connect". A
 * caller that cannot tell them apart reports a wait as a crash, and the natural
 * response to a crash is to retry — which is the behaviour the backoff exists
 * to prevent.
 */
export class AuthCooldownError extends Error {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "AuthCooldownError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function createGarminClient(): GarminConnectInstance {
  assertGarminCredentials();
  return new GarminConnect({
    username: appConfig.garminEmail,
    password: appConfig.garminPassword,
  });
}

export async function authenticateGarmin(force = false): Promise<GarminConnectInstance> {
  const client = createGarminClient();

  if (!force) {
    const storedSession = readStoredSession();

    if (storedSession) {
      client.loadToken(storedSession.oauth1, storedSession.oauth2);

      try {
        await client.getUserProfile();
        logger.info("Restored Garmin session from disk");
        return client;
      } catch (error) {
        logger.warn({ error }, "Stored Garmin session expired, re-authenticating");
      }
    }
  } else {
    clearStoredSession();
  }

  // Everything above this point is session reuse, which costs Connect nothing.
  // Below it is a real sign-in, and a real sign-in that keeps failing is what
  // gets an account locked. The backoff guards this call and nothing else.
  const fingerprint = credentialFingerprint(appConfig.garminEmail, appConfig.garminPassword);
  const cooldown = readAuthCooldown();
  const waitMs = remainingCooldownMs(cooldown, fingerprint, Date.now());

  if (waitMs > 0) {
    // Thrown before the request, not after: the whole point is that Connect
    // never sees this attempt.
    throw new AuthCooldownError(
      `Garmin sign-in is backing off after ${cooldown?.failures ?? 0} failed ` +
        `attempt${cooldown?.failures === 1 ? "" : "s"}. Waiting ${describeWait(waitMs)}. ` +
        `Correcting GARMIN_EMAIL or GARMIN_PASSWORD in .env clears this immediately — ` +
        `the wait is tied to the credentials that failed, not to the clock.` +
        (cooldown?.lastError ? ` Last error: ${cooldown.lastError}` : ""),
      Math.ceil(waitMs / 1000)
    );
  }

  try {
    await client.login();
    const tokens = client.exportToken();
    writeStoredSession(tokens as StoredSession);
    clearAuthCooldown();
    logger.info("Authenticated with Garmin Connect");
    return client;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown authentication error";
    const state = nextCooldownState(cooldown, fingerprint, Date.now(), message);
    writeAuthCooldown(state);
    logger.warn(
      { failures: state.failures, backoffSeconds: Math.ceil((state.blockedUntil - Date.now()) / 1000) },
      "Garmin sign-in failed; backing off before the next attempt"
    );
    throw new Error(
      `Garmin authentication failed: ${message}. Verify credentials in .env. MFA is not supported yet.`,
      { cause: error }
    );
  }
}
