import fs from "node:fs";
import { createHash } from "node:crypto";
import { dataPath } from "../paths.js";
import { readJsonFile } from "../utils/jsonFile.js";
import { writeSecretFile } from "../utils/secretFile.js";
import { logger } from "../utils/logger.js";

// SECTION: Sign-in backoff
//
// A failed Garmin login used to cost nothing and be remembered by nothing. Every
// call that needed data tried again immediately, and with a wrong password in
// `.env` that is an unbounded loop of sign-in attempts against Connect's auth
// endpoint. On a laptop somebody was watching, that was a bad minute. Now that
// the server runs unattended from a scheduled task, it is a bad week -- and the
// account it locks out is the user's own.
//
// So failures are recorded and the next attempt waits. Two design points are
// what make this a fix rather than an annoyance:
//
//   1. THE BACKOFF IS KEYED TO THE CREDENTIALS THAT FAILED. Correcting the
//      password in `.env` clears the cooldown on the spot, because the new
//      credentials have never failed. Without this, the fix for "wrong password"
//      would be "wrong password, now wait fifteen minutes", which is the kind of
//      safety feature people disable.
//
//   2. THE FIRST STEPS ARE SHORT. A dropped connection and a wrong password are
//      indistinguishable from here, so a transient blip costs 30 seconds, not a
//      quarter of an hour. Only repetition is treated as evidence.
//
// The credentials themselves are never stored -- only a SHA-256 of them, which
// is enough to answer "are these the same ones that failed?" and useless for
// anything else. The file is still written owner-only, because a hash of a
// password is not nothing.

const COOLDOWN_FILE = "auth-cooldown.json";

/** 30s, 1m, 2m, 4m, 8m, then 15m for every failure after that. */
const BACKOFF_STEPS_MS = [30_000, 60_000, 120_000, 240_000, 480_000];
const MAX_BACKOFF_MS = 900_000;

export interface AuthCooldownState {
  /** SHA-256 of the credentials these failures belong to. */
  credentialHash: string;
  /** Consecutive failed sign-ins for those credentials. */
  failures: number;
  /** Epoch milliseconds before which another attempt should not be made. */
  blockedUntil: number;
  /** The last failure's message, so the wait can explain itself. */
  lastError?: string;
}

/**
 * An opaque, stable identity for a credential pair.
 *
 * The NUL separator matters: without it, ("ab", "c") and ("a", "bc") hash the
 * same, and changing a password could silently inherit another one's failures.
 */
export function credentialFingerprint(email: string, password: string): string {
  return createHash("sha256").update(`${email}\u0000${password}`).digest("hex");
}

/** How long to wait after `failures` consecutive failures. */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  // `?? MAX_BACKOFF_MS` is not dead code under noUncheckedIndexedAccess: it is
  // also the answer for every failure past the end of the table.
  return BACKOFF_STEPS_MS[failures - 1] ?? MAX_BACKOFF_MS;
}

/**
 * Milliseconds still to wait, or 0 when an attempt is allowed now.
 *
 * State belonging to different credentials is not a wait: it is a record about
 * a password that is no longer in play.
 */
export function remainingCooldownMs(
  state: AuthCooldownState | null,
  fingerprint: string,
  now: number
): number {
  if (!state || state.credentialHash !== fingerprint) return 0;
  const remaining = state.blockedUntil - now;
  return remaining > 0 ? remaining : 0;
}

/** The state after one more failure, given what came before. */
export function nextCooldownState(
  previous: AuthCooldownState | null,
  fingerprint: string,
  now: number,
  errorMessage: string
): AuthCooldownState {
  const carried = previous && previous.credentialHash === fingerprint ? previous.failures : 0;
  const failures = carried + 1;
  return {
    credentialHash: fingerprint,
    failures,
    blockedUntil: now + backoffMs(failures),
    lastError: errorMessage,
  };
}

/** "45 seconds" / "2 minutes" — for a message a person has to act on. */
export function describeWait(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 90) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

// --- persistence -----------------------------------------------------------

function cooldownPath(): string {
  return dataPath(COOLDOWN_FILE);
}

export function readAuthCooldown(): AuthCooldownState | null {
  const filePath = cooldownPath();
  if (!fs.existsSync(filePath)) return null;

  try {
    const parsed = readJsonFile<AuthCooldownState>(filePath);
    if (typeof parsed.credentialHash !== "string" || typeof parsed.blockedUntil !== "number") {
      return null;
    }
    return parsed;
  } catch (error) {
    // An unreadable cooldown file must not be able to stop sign-in. The failure
    // mode of this feature has to be "does not throttle", never "cannot log in".
    logger.warn({ error }, "Could not read the sign-in backoff file; ignoring it");
    return null;
  }
}

export function writeAuthCooldown(state: AuthCooldownState): void {
  writeSecretFile(cooldownPath(), JSON.stringify(state, null, 2));
}

export function clearAuthCooldown(): void {
  const filePath = cooldownPath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
