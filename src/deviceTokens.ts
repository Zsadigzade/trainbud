import { createHash, randomBytes } from "node:crypto";

// SECTION: Per-device tokens
//
// A paired watch used to be handed `appConfig.mcpApiKey` -- the master key,
// the same credential that unlocks the dashboard and every MCP route. Two
// things followed from that. Revoking one watch meant rotating the key, which
// logged out everything else and, until 2.0.2, bricked the watch outright. And
// a token read off a watch was full server access, not watch access.
//
// A device token is minted per pairing, carried by the watch in exactly the
// same `Authorization: Bearer` header, and revocable on its own. The master key
// keeps working, so a watch paired before this change does not have to re-pair.

/**
 * The prefix is load-bearing, not decoration. Every authenticated request has
 * to decide whether a bearer token is the master key or a device token, and
 * without a marker that decision costs a database round trip on every single
 * request -- including the dashboard's, which never carries a device token.
 */
export const DEVICE_TOKEN_PREFIX = "tbd_";

/** 32 bytes from the CSPRNG. The prefix is not part of the entropy. */
export function generateDeviceToken(): string {
  return DEVICE_TOKEN_PREFIX + randomBytes(32).toString("hex");
}

/**
 * Only the hash is stored.
 *
 * `app.db` already holds the Anthropic key in the clear, which is why it is
 * chmod'd 0600 -- but a backup, a sync folder or a support upload defeats file
 * permissions, and a plaintext device token in that file is a working watch
 * credential for whoever reads it. A SHA-256 of a 256-bit random value has no
 * dictionary to attack: there is nothing to salt and nothing to guess.
 */
export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * A cheap structural check, deliberately not a security boundary.
 *
 * It decides which lookup to try, nothing more. A forged string carrying the
 * prefix still has to hash to a row that exists.
 */
export function looksLikeDeviceToken(token: string): boolean {
  return token.startsWith(DEVICE_TOKEN_PREFIX) && token.length === DEVICE_TOKEN_PREFIX.length + 64;
}

/** `watch-2026-09-06`, so the device list reads as something a human paired. */
export function defaultDeviceLabel(now = new Date()): string {
  return `watch-${now.toISOString().slice(0, 10)}`;
}
