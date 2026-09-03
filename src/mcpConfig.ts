import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeSecretFile } from "./utils/secretFile.js";
import { readJsonFile } from "./utils/jsonFile.js";

// SECTION: MCP Client Config

export interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * The user's config file, of which `mcpServers` is one key.
 *
 * The index signature is the point. This was typed and read as though the file
 * held nothing else, so `readMcpConfig` returned `{ mcpServers }` and everything
 * beside it -- `globalShortcut`, and whatever Claude Desktop adds next -- was
 * dropped on the way to being written back. This is not our file; it is a file
 * we add one key to.
 */
export interface McpConfigFile {
  mcpServers: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

export interface DetectedMcpClient {
  id: "cursor" | "claude-desktop";
  label: string;
  configPath: string;
}

export function getClaudeDesktopConfigPath(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Claude", "claude_desktop_config.json");
  }

  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(configHome, "Claude", "claude_desktop_config.json");
}

export function getCursorConfigPath(): string {
  return path.join(os.homedir(), ".cursor", "mcp.json");
}

export function detectMcpClients(): DetectedMcpClient[] {
  const clients: DetectedMcpClient[] = [];
  const cursorPath = getCursorConfigPath();
  const claudePath = getClaudeDesktopConfigPath();

  if (fs.existsSync(path.dirname(cursorPath))) {
    clients.push({
      id: "cursor",
      label: "Cursor",
      configPath: cursorPath,
    });
  }

  if (fs.existsSync(path.dirname(claudePath))) {
    clients.push({
      id: "claude-desktop",
      label: "Claude Desktop",
      configPath: claudePath,
    });
  }

  return clients;
}

export function readMcpConfig(configPath: string): McpConfigFile {
  if (!fs.existsSync(configPath)) {
    return { mcpServers: {} };
  }

  try {
    const parsed = readJsonFile<Partial<McpConfigFile>>(configPath);

    // Everything the file holds, with `mcpServers` normalised. A config with no
    // `mcpServers` key at all is perfectly valid -- and the old
    // `if (!parsed.mcpServers) return { mcpServers: {} }` discarded the entire
    // file to add one server to it.
    const servers =
      parsed.mcpServers && typeof parsed.mcpServers === "object" ? parsed.mcpServers : {};

    return { ...parsed, mcpServers: servers };
  } catch {
    throw new Error(`Could not read MCP config at ${configPath}. Fix the file or choose another client.`);
  }
}

export function buildTrainBudServerEntry(credentials: {
  email: string;
  password: string;
  distIndexPath: string;
}): McpServerEntry {
  const normalizedIndexPath = credentials.distIndexPath.replace(/\\/g, "/");

  return {
    command: "node",
    args: [normalizedIndexPath, "start"],
    env: {
      GARMIN_EMAIL: credentials.email,
      GARMIN_PASSWORD: credentials.password,
    },
  };
}

export function mergeTrainBudConfig(
  config: McpConfigFile,
  credentials: { email: string; password: string; distIndexPath: string }
): McpConfigFile {
  return {
    ...config,
    mcpServers: {
      ...config.mcpServers,
      "trainbud": buildTrainBudServerEntry(credentials),
    },
  };
}

export function writeMcpConfig(configPath: string, config: McpConfigFile): void {
  // This file carries GARMIN_PASSWORD in its env block, so it is as sensitive
  // as .env and gets the same permissions.
  writeSecretFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * Where the pre-setup copy of a config is kept.
 *
 * `setup` is the command the docs tell a user to run when something is wrong,
 * and it rewrites a file it does not own. `writeEnvFile` has already deleted
 * someone's ANTHROPIC_API_KEY that way once. A copy costs nothing and is the
 * difference between a mistake and a loss.
 */
export function backupPathFor(configPath: string): string {
  const directory = path.dirname(configPath);
  const base = path.basename(configPath, path.extname(configPath));
  return path.join(directory, `${base}.bak.json`);
}

export function configureTrainBudForClient(
  client: DetectedMcpClient,
  credentials: { email: string; password: string; distIndexPath: string }
): void {
  const existing = readMcpConfig(client.configPath);

  // Written through writeSecretFile: once merged, this file carries
  // GARMIN_PASSWORD in an env block, so the copy is exactly as sensitive as the
  // original and gets the same 0600.
  if (fs.existsSync(client.configPath)) {
    writeSecretFile(backupPathFor(client.configPath), fs.readFileSync(client.configPath, "utf8"));
  }

  const merged = mergeTrainBudConfig(existing, credentials);
  writeMcpConfig(client.configPath, merged);
}
