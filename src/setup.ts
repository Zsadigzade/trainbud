import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import fs from "node:fs";
import { authenticateGarmin, clearStoredSession } from "./garmin/auth.js";
import { resetGarminClient } from "./garmin/client.js";
import {
  assertGarminCredentials,
  getDistIndexPath,
  writeEnvFile,
  appConfig,
} from "./config.js";
import { configureLogger } from "./utils/logger.js";
import {
  configureTrainBudForClient,
  detectMcpClients,
  type DetectedMcpClient,
} from "./mcpConfig.js";
import { printLiveCheckResults, runLiveCheck } from "./check.js";

// SECTION: Interactive Setup

async function promptLine(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  const answer = (await rl.question(question)).trim();
  return answer;
}

async function promptSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    output.write(question);

    if (!input.isTTY || typeof input.setRawMode !== "function") {
      void (async () => {
        const rl = createInterface({ input, output });
        const answer = (await rl.question("")).trim();
        rl.close();
        resolve(answer);
      })();
      return;
    }

    input.resume();
    input.setRawMode(true);
    input.setEncoding("utf8");

    let password = "";

    const onData = (chunk: string): void => {
      const char = chunk;

      if (char === "\n" || char === "\r" || char === "\u0004") {
        input.setRawMode(false);
        input.removeListener("data", onData);
        output.write("\n");
        resolve(password);
        return;
      }

      if (char === "\u0003") {
        process.exit(130);
      }

      if (char === "\u007F" || char === "\b") {
        password = password.slice(0, -1);
        return;
      }

      password += char;
      output.write("*");
    };

    input.on("data", onData);
  });
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function promptCredentials(): Promise<{ email: string; password: string }> {
  const rl = createInterface({ input, output });

  try {
    output.write("\nTrainBud setup\n");
    output.write("This wizard will save credentials locally, authenticate with Garmin Connect,\n");
    output.write("and optionally connect TrainBud to Cursor or Claude Desktop.\n\n");
    output.write("Note: MFA must be disabled on your Garmin Connect account.\n\n");

    let email = "";

    while (!email) {
      const value = await promptLine(rl, "Garmin Connect email: ");
      if (!value) {
        output.write("Email is required.\n");
        continue;
      }

      if (!isValidEmail(value)) {
        output.write("Enter a valid email address.\n");
        continue;
      }

      email = value;
    }

    rl.close();

    let password = "";

    while (!password) {
      password = await promptSecret("Garmin Connect password: ");
      if (!password) {
        output.write("Password is required.\n");
      }
    }

    return { email, password };
  } finally {
    rl.close();
  }
}

async function promptMcpClients(clients: DetectedMcpClient[]): Promise<DetectedMcpClient[]> {
  if (clients.length === 0) {
    output.write("\nNo supported MCP clients were detected on this machine.\n");
    output.write("You can add TrainBud manually later using QUICKSTART.md.\n");
    return [];
  }

  const rl = createInterface({ input, output });

  try {
    output.write("\nDetected MCP clients:\n");
    clients.forEach((client, index) => {
      output.write(`  ${index + 1}. ${client.label} (${client.configPath})\n`);
    });
    output.write("  A. All detected clients\n");
    output.write("  S. Skip MCP client setup\n\n");

    while (true) {
      const answer = (await rl.question("Configure which client? [1/A/S]: ")).trim().toLowerCase();

      if (answer === "s" || answer === "skip" || answer === "") {
        return [];
      }

      if (answer === "a" || answer === "all") {
        return clients;
      }

      const index = Number.parseInt(answer, 10);
      if (Number.isFinite(index) && index >= 1 && index <= clients.length) {
        return [clients[index - 1]!];
      }

      output.write("Enter a number from the list, A for all, or S to skip.\n");
    }
  } finally {
    rl.close();
  }
}

async function promptRunLiveCheck(): Promise<boolean> {
  const rl = createInterface({ input, output });

  try {
    const answer = (await rl.question("\nRun a live Garmin API check now? [Y/n]: ")).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export async function runSetup(): Promise<void> {
  const credentials = await promptCredentials();
  const envPath = writeEnvFile(credentials);

  output.write(`\nSaved credentials to ${envPath}\n`);
  output.write("Authenticating with Garmin Connect...\n");

  configureLogger(appConfig.logPath);
  clearStoredSession();
  resetGarminClient();

  try {
    await authenticateGarmin(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication failed";
    output.write(`\nAuthentication failed.\n${message}\n`);
    output.write("\nCommon fixes:\n");
    output.write("- Verify your email and password\n");
    output.write("- Disable MFA at connect.garmin.com → Account Settings → Security\n");
    output.write("- Run `trainbud setup` again after fixing credentials\n");
    process.exitCode = 1;
    return;
  }

  output.write("Garmin authentication successful. Session saved.\n");

  const distIndexPath = getDistIndexPath();
  if (!fs.existsSync(distIndexPath)) {
    output.write(`\nWarning: ${distIndexPath} was not found. Run \`npm run build\` before starting the MCP server.\n`);
  }

  const detectedClients = detectMcpClients();
  const selectedClients = await promptMcpClients(detectedClients);

  for (const client of selectedClients) {
    configureTrainBudForClient(client, {
      email: credentials.email,
      password: credentials.password,
      distIndexPath,
    });
    output.write(`Configured TrainBud in ${client.label} (${client.configPath})\n`);
  }

  output.write("\nSetup complete.\n");

  output.write("\nWeb AI connector (claude.ai, ChatGPT):\n");
  output.write(`- API key saved to .env as TRAINBUD_API_KEY\n`);
  output.write(`- Run: trainbud serve\n`);
  output.write(`- See docs/WEB-MCP.md for Cloudflare Tunnel + claude.ai setup\n`);
  output.write(`- Your API key: ${appConfig.mcpApiKey}\n`);

  if (selectedClients.length > 0) {
    output.write("\nNext steps:\n");
    output.write("- Restart your MCP client completely so it picks up the new server\n");
    output.write("- Ask things like \"What was my last workout?\" or \"How did I sleep this week?\"\n");
  } else {
    output.write("\nNext steps:\n");
    output.write("- Run `trainbud start` for manual MCP usage, or follow QUICKSTART.md to connect a client\n");
  }

  if (await promptRunLiveCheck()) {
    assertGarminCredentials();
    const results = await runLiveCheck();
    output.write("\n");
    printLiveCheckResults(results);

    if (results.some((result) => !result.ok)) {
      process.exitCode = 1;
    }
  }
}
