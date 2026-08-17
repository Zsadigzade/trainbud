import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// SECTION: Data directory resolution and legacy migration
//
// Before the rename to TrainBud, state lived in `.garmin/` and was resolved
// against `process.cwd()` in some places and the project root in others, so a
// globally installed CLI could scatter state across every directory it ran in.
// Everything now resolves against the project root, and `.garmin/` is migrated
// to `.trainbud/` once, on first run.

export const DATA_DIR_NAME = ".trainbud";
export const LEGACY_DATA_DIR_NAME = ".garmin";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function getProjectRoot(): string {
  return projectRoot;
}

/** Resolve a path that may be absolute, or relative to the project root. */
export function resolveFromRoot(target: string): string {
  return path.isAbsolute(target) ? target : path.resolve(projectRoot, target);
}

export function getDataDir(): string {
  return path.join(projectRoot, DATA_DIR_NAME);
}

export function getLegacyDataDir(): string {
  return path.join(projectRoot, LEGACY_DATA_DIR_NAME);
}

export function dataPath(...segments: string[]): string {
  return path.join(getDataDir(), ...segments);
}

export function ensureDataDir(): string {
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export interface MigrationResult {
  migrated: boolean;
  from?: string;
  to?: string;
  movedEntries?: string[];
  reason?: string;
}

/**
 * Move `.garmin/` to `.trainbud/` once. Idempotent and non-destructive: if the
 * new directory already exists, individual entries are only copied when they
 * are not already present, and the legacy directory is left on disk.
 */
export function migrateLegacyDataDir(): MigrationResult {
  const legacyDir = getLegacyDataDir();
  const dir = getDataDir();

  if (!fs.existsSync(legacyDir)) {
    return { migrated: false, reason: "no legacy directory" };
  }

  // Fast path: nothing at the new location yet, so a rename is enough.
  if (!fs.existsSync(dir)) {
    const entries = fs.readdirSync(legacyDir);
    try {
      fs.renameSync(legacyDir, dir);
      return { migrated: true, from: legacyDir, to: dir, movedEntries: entries };
    } catch {
      // Rename can fail across devices or when a file is locked; fall through
      // to the copy path rather than leaving the user with no data directory.
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const moved: string[] = [];
  for (const entry of fs.readdirSync(legacyDir)) {
    const source = path.join(legacyDir, entry);
    const destination = path.join(dir, entry);
    if (fs.existsSync(destination)) {
      continue;
    }
    fs.cpSync(source, destination, { recursive: true });
    moved.push(entry);
  }

  return moved.length > 0
    ? { migrated: true, from: legacyDir, to: dir, movedEntries: moved }
    : { migrated: false, reason: "already migrated" };
}

/**
 * Read an environment variable, falling back to its pre-rename name.
 * Returns the value plus the name it was found under, so callers can warn.
 */
export function readRenamedEnv(
  name: string,
  legacyName: string
): { value: string | undefined; usedLegacy: boolean } {
  const value = process.env[name];
  if (value !== undefined && value !== "") {
    return { value, usedLegacy: false };
  }
  const legacyValue = process.env[legacyName];
  if (legacyValue !== undefined && legacyValue !== "") {
    return { value: legacyValue, usedLegacy: true };
  }
  return { value: undefined, usedLegacy: false };
}
