import fs from "node:fs";
import path from "node:path";
import type { GarminConnectInstance } from "./garminConnect.js";
import { GarminConnect } from "./garminConnect.js";
import { appConfig, assertGarminCredentials } from "../config.js";
import { logger } from "../utils/logger.js";
import { writeSecretFile } from "../utils/secretFile.js";
import type { StoredSession } from "./types.js";

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
    const raw = fs.readFileSync(sessionPath, "utf8");
    const parsed = JSON.parse(raw) as StoredSession;

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

  try {
    await client.login();
    const tokens = client.exportToken();
    writeStoredSession(tokens as StoredSession);
    logger.info("Authenticated with Garmin Connect");
    return client;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown authentication error";
    throw new Error(
      `Garmin authentication failed: ${message}. Verify credentials in .env. MFA is not supported yet.`,
      { cause: error }
    );
  }
}
