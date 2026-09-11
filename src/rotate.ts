import { createInterface } from "node:readline/promises";
import {
  appConfig,
  currentEnvNameFor,
  deprecatedEnvNames,
  generateApiKey,
  getEnvFilePath,
  setEnvValue,
} from "./config.js";
import { deleteSetting, getSetting, setSetting } from "./appDb.js";
import { logger } from "./utils/logger.js";

// SECTION: Secret rotation
//
// Rotating a secret used to mean re-running `trainbud setup`, which rebuilds the
// whole `.env` from a template and demands the Connect credentials on the way
// through -- so changing the AI key meant re-typing a Garmin password and
// re-authenticating with Connect. Nobody does that. People edit `.env` by hand
// instead, and that is how the two copies of the AI key drifted: `app.db` held
// a different, stale key than `.env`, the dashboard read the database one, and
// a key that had been "rotated" was still the one being charged.
//
// So this file has one rule:
//
//   A SECRET WITH TWO HOMES IS WRITTEN TO BOTH, OR TO NEITHER.
//
// and one job beyond writing: saying out loud what the rotation invalidated.
// A key that is replaced without the paired watch being told is a watch that
// silently stops working an hour later.

const AI_KEY_SETTING = "anthropic_api_key";

export interface RotationOutcome {
  ok: boolean;
  lines: string[];
}

/** Enough of a key to recognise, never enough to use. */
export function maskSecret(value: string): string {
  if (!value) return "(not set)";
  if (value.length <= 8) return `${value.slice(0, 2)}…`;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/**
 * Where each secret currently lives, and whether its homes agree.
 *
 * This is the check that would have caught the stale-key incident on its own:
 * both stores are read and compared rather than either being trusted.
 */
export function describeSecretState(): RotationOutcome {
  const envAiKey = process.env.ANTHROPIC_API_KEY ?? "";
  const dbAiKey = getSetting(AI_KEY_SETTING) ?? "";

  const lines: string[] = [];
  lines.push(`.env file:        ${getEnvFilePath()}`);
  lines.push("");
  lines.push(`TrainBud API key  ${maskSecret(appConfig.mcpApiKey)}   (.env)`);
  lines.push("");
  lines.push("AI provider key");
  lines.push(`  .env            ${maskSecret(envAiKey)}`);
  lines.push(`  app.db          ${maskSecret(dbAiKey)}`);

  let ok = true;

  if (envAiKey && dbAiKey && envAiKey !== dbAiKey) {
    ok = false;
    lines.push("");
    lines.push("  ⚠ THESE DISAGREE. The database copy is the one actually used —");
    lines.push("    resolveAnthropicKey() reads the setting first and only falls back");
    lines.push("    to the environment. A key you changed in .env is not in effect.");
    lines.push("    Fix both at once:  trainbud rotate ai-key");
  } else if (!envAiKey && !dbAiKey) {
    lines.push("");
    lines.push("  No AI key set. The Ask card and the daily insight stay empty;");
    lines.push("  everything else on the watch is computed in code and still works.");
  } else {
    lines.push("");
    lines.push("  ✓ Both stores agree.");
  }

  return { ok, lines };
}

async function promptSecret(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    // The same masking the setup wizard uses: a key pasted into a terminal that
    // echoes it ends up in scrollback and in shell history exports.
    const answer = await rl.question(question);
    return answer.trim();
  } finally {
    rl.close();
  }
}

/**
 * Replace the TrainBud API key.
 *
 * This is the bearer token for `/mcp` and the master key the dashboard accepts,
 * so rotating it invalidates every remote MCP connector immediately. Paired
 * watches holding their own per-device token are unaffected — but one paired
 * before 0.5.2 holds the master key itself and will stop working, which is
 * exactly the case that is invisible until the watch goes blank.
 */
export function rotateApiKey(explicitKey?: string): RotationOutcome {
  const previous = appConfig.mcpApiKey;
  const next = (explicitKey ?? generateApiKey()).trim();

  if (!next) {
    return { ok: false, lines: ["Refusing to write an empty API key."] };
  }
  if (next === previous) {
    return { ok: false, lines: ["That is the key already in use. Nothing was changed."] };
  }

  const envPath = setEnvValue("TRAINBUD_API_KEY", next);
  logger.info("TrainBud API key rotated");

  return {
    ok: true,
    lines: [
      `New TrainBud API key: ${next}`,
      `Written to ${envPath}`,
      "",
      "What just stopped working, and what to do about it:",
      "  1. RESTART THE SERVER. The running process still holds the old key.",
      // There is no Restart-ScheduledTask cmdlet. Stop then Start is the whole
      // API, and a message naming a cmdlet that does not exist is worse than no
      // message: it reads as authoritative and fails at the prompt.
      "       Scheduled task:  Stop-ScheduledTask -TaskName 'TrainBud Server'; Start-ScheduledTask -TaskName 'TrainBud Server'",
      "       Foreground:      stop it and run `trainbud serve` again",
      "  2. Every remote MCP connector (claude.ai, ChatGPT) now 401s. Paste the",
      "     new key as the bearer token in each one.",
      "  3. Your dashboard bookmark carries the old token. Open it once with",
      "     ?token=<the new key> and it will set a fresh cookie.",
      "  4. A watch paired BEFORE 0.5.2 holds this master key rather than its own",
      "     per-device token and will stop working. `trainbud devices list` shows",
      "     what is paired; anything missing from that list is on the master key.",
      "     Re-pair it from the watch.",
    ],
  };
}

/**
 * Replace the AI provider key in both of its homes at once.
 *
 * Passing an empty string removes it from both, which is the honest way to turn
 * the AI features off — clearing one store and leaving the other is how a key
 * you thought you had deleted keeps being charged.
 */
export function rotateAiKey(next: string): RotationOutcome {
  const trimmed = next.trim();

  if (!trimmed) {
    deleteSetting(AI_KEY_SETTING);
    const envPath = setEnvValue("ANTHROPIC_API_KEY", "");
    return {
      ok: true,
      lines: [
        "AI provider key cleared from BOTH the database and .env.",
        `  ${envPath}`,
        "",
        "The Ask card and the daily insight will be empty. Every other number on",
        "the watch is computed in code and is unaffected.",
        "Restart the server so the running process drops the old key.",
      ],
    };
  }

  setSetting(AI_KEY_SETTING, trimmed);
  const envPath = setEnvValue("ANTHROPIC_API_KEY", trimmed);

  return {
    ok: true,
    lines: [
      `AI provider key set to ${maskSecret(trimmed)} in BOTH stores:`,
      "  app.db  settings.anthropic_api_key   ← the one actually read",
      `  ${envPath}`,
      "",
      "Restart the server so the running process picks it up.",
      "Revoke the old key at your provider's console — writing a new one here",
      "does not disable the old one anywhere else.",
    ],
  };
}

/**
 * Rewrite pre-0.3.0 variable names in `.env` to their current spellings.
 *
 * The old names still work, which is why this was never urgent — but every
 * start printed a deprecation line, and after the server moved to a scheduled
 * task that line lands in the log on every boot forever. A warning that fires
 * on every single run is a warning people stop reading, which costs more than
 * the thing it warns about.
 *
 * `setEnvValue` already replaces a deprecated spelling when it writes the
 * current one, so this is that operation applied to whatever is present.
 */
export function upgradeEnvNames(): RotationOutcome {
  const stale = deprecatedEnvNames();

  if (stale.length === 0) {
    return { ok: true, lines: ["No deprecated variable names in .env. Nothing to do."] };
  }

  const renamed: string[] = [];
  for (const legacy of stale) {
    const current = currentEnvNameFor(legacy);
    if (!current) continue;
    const value = process.env[legacy];
    if (value === undefined) continue;
    setEnvValue(current, value);
    renamed.push(`  ${legacy}  →  ${current}`);
  }

  if (renamed.length === 0) {
    return { ok: false, lines: ["Found deprecated names but could not read their values."] };
  }

  return {
    ok: true,
    lines: [
      `Renamed ${renamed.length} variable${renamed.length === 1 ? "" : "s"} in ${getEnvFilePath()}:`,
      ...renamed,
      "",
      "Values are unchanged — only the names. Restart the server to stop the",
      "deprecation warning appearing in its log.",
    ],
  };
}

/** Interactive entry point for `trainbud rotate ai-key` with no --key. */
export async function promptAndRotateAiKey(): Promise<RotationOutcome> {
  const current = getSetting(AI_KEY_SETTING) ?? process.env.ANTHROPIC_API_KEY ?? "";
  process.stdout.write(`Current AI provider key: ${maskSecret(current)}\n`);
  process.stdout.write("Paste the new key, or press Enter on an empty line to remove it.\n");
  const entered = await promptSecret("New key: ");
  return rotateAiKey(entered);
}
