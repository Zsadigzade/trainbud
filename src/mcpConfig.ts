import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeSecretFile } from "./utils/secretFile.js";

// SECTION: MCP Client Config

export interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface McpConfigFile {
  mcpServers: Record<string, McpServerEntry>;
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
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<McpConfigFile>;

    if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
      return { mcpServers: {} };
    }

    return { mcpServers: parsed.mcpServers };
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

export function configureTrainBudForClient(
  client: DetectedMcpClient,
  credentials: { email: string; password: string; distIndexPath: string }
): void {
  const existing = readMcpConfig(client.configPath);
  const merged = mergeTrainBudConfig(existing, credentials);
  writeMcpConfig(client.configPath, merged);
}
