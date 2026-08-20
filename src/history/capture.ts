import fs from "node:fs";
import path from "node:path";
import type { IngestSource } from "./schema.js";

// SECTION: Fixture capture
//
// The stress mapper shipped broken because its test was written against a
// payload nobody had ever received: it read `overallStressLevel`, Connect sends
// `avgStressLevel`, and the test passed because it asserted against the same
// invention. tests/rawApi.test.ts still carries both versions side by side as
// the record of it.
//
// Detectors are far more elaborate than that mapper, so their fixtures have to
// come off the wire. Ingest is already keeping the raw responses; this only
// scrubs the identifiers so one can be committed.

const REDACTION = "<redacted>";

/**
 * Matched case-insensitively against the key name. Identity and credentials
 * only -- never a measurement, never a date. A fixture with its numbers
 * redacted would be worse than the invented payload it replaces.
 */
export const REDACTED_KEYS = [
  "userprofilepk",
  "userprofileid",
  "userid",
  "displayname",
  "fullname",
  "email",
  "ownerid",
  "ownerdisplayname",
  "ownerfullname",
  "ownerprofileimageurl",
  "devicename",
  "deviceid",
  "unitid",
];

function isRedactedKey(key: string): boolean {
  const lower = key.toLowerCase();

  if (REDACTED_KEYS.includes(lower)) {
    return true;
  }

  return lower.endsWith("token") || lower.endsWith("key") || lower.endsWith("secret");
}

/** Deep clone with identity fields replaced. Never mutates its input. */
export function redactPayload(payload: unknown): unknown {
  if (payload === null || typeof payload !== "object") {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map((entry) => redactPayload(entry));
  }

  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    redacted[key] = isRedactedKey(key) ? REDACTION : redactPayload(value);
  }

  return redacted;
}

/** Writes one redacted response to `<dir>/<source>-<date>.json`. */
export function writeFixture(
  directory: string,
  source: IngestSource,
  date: string,
  payload: unknown
): string {
  fs.mkdirSync(directory, { recursive: true });

  const file = path.join(directory, `${source}-${date}.json`);
  fs.writeFileSync(file, `${JSON.stringify(redactPayload(payload), null, 2)}\n`, "utf8");

  return file;
}
