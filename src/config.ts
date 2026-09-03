import { config as loadEnv } from "dotenv";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DATA_DIR_NAME,
  dataPath,
  getProjectRoot,
  readRenamedEnv,
  remapLegacyPath,
} from "./paths.js";
import { writeSecretFile } from "./utils/secretFile.js";

const projectRoot = getProjectRoot();
const defaultEnvPath = path.join(projectRoot, ".env");

loadEnv({ path: defaultEnvPath, quiet: true });

// SECTION: Environment variables
//
// Product-scoped variables were renamed from GARMIN_* to TRAINBUD_* in 0.3.0.
// The old names still work and are reported by `deprecatedEnvNames()` so the
// CLI can warn once. GARMIN_EMAIL / GARMIN_PASSWORD are deliberately unchanged:
// they name the third-party Connect account the credentials belong to, not this
// product, and renaming them would make the .env actively misleading.

const RENAMED_ENV: Record<string, string> = {
  TRAINBUD_API_KEY: "GARMIN_MCP_API_KEY",
  TRAINBUD_HOST: "GARMIN_MCP_HOST",
  TRAINBUD_PORT: "GARMIN_MCP_PORT",
  TRAINBUD_SESSION_PATH: "GARMIN_SESSION_PATH",
  TRAINBUD_LOG_PATH: "GARMIN_LOG_PATH",
  TRAINBUD_CACHE_PATH: "GARMIN_CACHE_PATH",
  TRAINBUD_PUBLIC_URL: "GARMIN_PUBLIC_URL",
};

function readEnv(name: string): string | undefined {
  const legacyName = RENAMED_ENV[name];
  if (!legacyName) {
    const value = process.env[name];
    return value === "" ? undefined : value;
  }
  return readRenamedEnv(name, legacyName).value;
}

/** Legacy env var names still present in the environment, for a one-time warning. */
export function deprecatedEnvNames(): string[] {
  return Object.entries(RENAMED_ENV)
    .filter(([name, legacyName]) => readRenamedEnv(name, legacyName).usedLegacy)
    .map(([, legacyName]) => legacyName);
}

function readNumber(name: string, fallback: number): number {
  const value = readEnv(name);
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getSessionPath(): string {
  return remapLegacyPath(readEnv("TRAINBUD_SESSION_PATH") ?? dataPath("session.json"));
}

export { getProjectRoot };

export function getEnvFilePath(): string {
  return defaultEnvPath;
}

export function getDistIndexPath(): string {
  return path.resolve(projectRoot, "dist", "index.js");
}

export function generateApiKey(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Quote a value so dotenv reads back exactly what was written.
 *
 * Values were written bare, and dotenv treats an unquoted `#` as the start of a
 * comment: a Garmin password containing one was silently truncated at that
 * character, so setup "succeeded" and every login afterwards failed with bad
 * credentials the user could see were correct. Measured, not assumed --
 * `P=pa#ss` parses back as `pa`.
 *
 * Single quotes are preferred: dotenv does no unescaping inside them, so `#`,
 * `"`, `$`, spaces and backslashes all survive verbatim. Double quotes are the
 * fallback for a value containing a single quote. A value containing both
 * cannot be represented -- dotenv has no escape that works inside either kind --
 * so that is an error rather than a silent corruption.
 */
export function quoteEnvValue(value: string): string {
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  if (!value.includes('"')) {
    return `"${value}"`;
  }
  throw new Error(
    "A value containing both ' and \" cannot be stored in .env. Change the password, or set it in the environment instead."
  );
}

/** Keys this file writes itself. Anything else in an existing .env is the
    user's and is carried across untouched. */
const MANAGED_ENV_KEYS = new Set([
  "GARMIN_EMAIL",
  "GARMIN_PASSWORD",
  "TRAINBUD_API_KEY",
  "TRAINBUD_HOST",
  "TRAINBUD_PORT",
  "TRAINBUD_SESSION_PATH",
  "TRAINBUD_LOG_PATH",
  "TRAINBUD_CACHE_PATH",
  "CACHE_TTL_ACTIVITIES",
  "CACHE_TTL_SLEEP",
  "CACHE_TTL_STATS",
  // The pre-0.3.0 names for the same settings, so re-running setup does not
  // resurrect a duplicate under the old name.
  "GARMIN_MCP_API_KEY",
  "GARMIN_MCP_HOST",
  "GARMIN_MCP_PORT",
  "GARMIN_SESSION_PATH",
  "GARMIN_LOG_PATH",
  "GARMIN_CACHE_PATH",
]);

/**
 * Every assignment in an existing .env that this file does not manage.
 *
 * writeEnvFile rebuilt the file from a fixed template, so re-running
 * `trainbud setup` deleted ANTHROPIC_API_KEY and TRAINBUD_PUBLIC_URL outright --
 * a user who had followed the AI setup guide lost their key by running the
 * command the guide tells them to run when something is wrong.
 */
export function carriedEnvLines(existing: string): string[] {
  const carried: string[] = [];

  for (const line of existing.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match && !MANAGED_ENV_KEYS.has(match[1] as string)) {
      carried.push(line.trim());
    }
  }

  return carried;
}

export function writeEnvFile(credentials: { email: string; password: string; apiKey?: string }): string {
  const envPath = getEnvFilePath();
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const existingApiKey =
    existing.match(/^TRAINBUD_API_KEY=(.+)$/m)?.[1]?.trim() ??
    existing.match(/^GARMIN_MCP_API_KEY=(.+)$/m)?.[1]?.trim();
  const apiKey = (credentials.apiKey ?? existingApiKey ?? generateApiKey())
    .replace(/^['"]|['"]$/g, "");
  const carried = carriedEnvLines(existing);

  const lines = [
    "# Connect account these credentials belong to",
    `GARMIN_EMAIL=${quoteEnvValue(credentials.email)}`,
    `GARMIN_PASSWORD=${quoteEnvValue(credentials.password)}`,
    "",
    "# TrainBud server",
    `TRAINBUD_API_KEY=${quoteEnvValue(apiKey)}`,
    "TRAINBUD_HOST=127.0.0.1",
    "TRAINBUD_PORT=3847",
    `TRAINBUD_SESSION_PATH=${DATA_DIR_NAME}/session.json`,
    `TRAINBUD_LOG_PATH=${DATA_DIR_NAME}/server.log`,
    `TRAINBUD_CACHE_PATH=${DATA_DIR_NAME}/cache.db`,
    "CACHE_TTL_ACTIVITIES=1800",
    "CACHE_TTL_SLEEP=7200",
    "CACHE_TTL_STATS=3600",
    "",
    "# Optional — AI features (bring your own key)",
    ...(carried.some((line) => line.startsWith("ANTHROPIC_API_KEY="))
      ? []
      : ["# ANTHROPIC_API_KEY=sk-ant-..."]),
    ...(carried.some((line) => line.startsWith("TRAINBUD_PUBLIC_URL="))
      ? []
      : ["# TRAINBUD_PUBLIC_URL=https://your-tunnel.example.com"]),
    ...(carried.length > 0 ? ["", "# Kept from your previous .env", ...carried] : []),
    "",
  ];

  writeSecretFile(envPath, lines.join("\n"));
  loadEnv({ path: envPath, override: true, quiet: true });
  return envPath;
}

export const appConfig = {
  get garminEmail(): string {
    return process.env.GARMIN_EMAIL ?? "";
  },
  get garminPassword(): string {
    return process.env.GARMIN_PASSWORD ?? "";
  },
  get sessionPath(): string {
    return getSessionPath();
  },
  get logPath(): string {
    return remapLegacyPath(readEnv("TRAINBUD_LOG_PATH") ?? dataPath("server.log"));
  },
  get cachePath(): string {
    return remapLegacyPath(readEnv("TRAINBUD_CACHE_PATH") ?? dataPath("cache.db"));
  },
  get cacheTtlActivities(): number {
    return readNumber("CACHE_TTL_ACTIVITIES", 1800);
  },
  get cacheTtlSleep(): number {
    return readNumber("CACHE_TTL_SLEEP", 7200);
  },
  get cacheTtlStats(): number {
    return readNumber("CACHE_TTL_STATS", 3600);
  },
  get mcpHost(): string {
    return readEnv("TRAINBUD_HOST") ?? "127.0.0.1";
  },
  get mcpPort(): number {
    return readNumber("TRAINBUD_PORT", 3847);
  },
  get mcpApiKey(): string {
    return readEnv("TRAINBUD_API_KEY") ?? "";
  },
  get anthropicApiKey(): string {
    return process.env.ANTHROPIC_API_KEY ?? "";
  },
  get publicUrl(): string {
    const envUrl = (readEnv("TRAINBUD_PUBLIC_URL") ?? "").replace(/\/$/, "");
    if (envUrl) return envUrl;
    try {
      const data = JSON.parse(fs.readFileSync(dataPath("watch-setup.json"), "utf8")) as {
        serverUrl?: string;
      };
      return (data.serverUrl ?? "").replace(/\/$/, "");
    } catch {
      return "";
    }
  },
};

export function assertApiKey(): void {
  if (!appConfig.mcpApiKey) {
    throw new Error(
      'Missing TRAINBUD_API_KEY. Run "trainbud setup" or add TRAINBUD_API_KEY to .env before "trainbud serve".'
    );
  }
}

export function assertGarminCredentials(): void {
  if (!appConfig.garminEmail || !appConfig.garminPassword) {
    throw new Error(
      "Missing GARMIN_EMAIL or GARMIN_PASSWORD. Copy .env.example to .env and add your Connect account credentials."
    );
  }
}
