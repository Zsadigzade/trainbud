import { appConfig } from "./config.js";
import { isAiConfigured } from "./promptApi.js";
import { getPendingPairings } from "./pairApi.js";
import { runDetectors } from "./detect/index.js";

// SECTION: Self test
//
// Answers the one question nothing in this project could answer from the
// inside: what would the watch see if it asked right now?
//
// The bug that produced this file was reported as "AI Unavailable, Error HTTP
// -400". The watch was fine, the server was fine, and the AI was fine. The
// tunnel was down, so ngrok answered an HTML error page, Connect IQ could not
// parse it as JSON, and the watch reported -400. Everything on this machine
// looked healthy because everything on this machine WAS healthy -- the failure
// lived in the one hop nothing tested.
//
// So this fetches the server's own public URL from outside itself and grades
// the answer with the same taxonomy the watch uses. A dashboard that can say
// "your public URL is returning HTML, so the watch will show 'Not a TrainBud
// server'" turns a two-day investigation into a sentence.

/** Mirrors Fail.mc on the watch, so both surfaces name a failure the same way. */
export type ReachClass =
  | "ok"
  | "unreachable"
  | "not_server"
  | "unauthorized"
  | "refused"
  | "not_configured";

export interface CheckLine {
  name: string;
  ok: boolean;
  /** True for something that is not wrong yet but will bite. */
  warning?: boolean;
  detail: string;
  /** The single next action, when there is one. */
  fix?: string;
}

export interface SelfTestResult {
  reach: ReachClass;
  publicUrl: string;
  checks: CheckLine[];
  ok: boolean;
}

/**
 * Connect IQ sends `Mozilla/5.0` and does not let an app override it, which is
 * why ngrok's free tier used to answer the watch with an HTML interstitial
 * while curl got clean JSON. Impersonating the watch exactly -- browser UA,
 * the skip header, JSON expected -- is the entire point: a probe that is
 * treated better than the real client tests nothing.
 */
const WATCH_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0",
  "ngrok-skip-browser-warning": "1",
};

const PROBE_TIMEOUT_MS = 10_000;

function classify(status: number): ReachClass {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "refused";
  if (status >= 500) return "unreachable";
  return status === 200 ? "ok" : "not_server";
}

export interface ProbeOutcome {
  reach: ReachClass;
  status: number | null;
  contentType: string | null;
  bodyStart: string;
  error?: string;
}

/**
 * Fetches `${baseUrl}/health` the way the watch would.
 *
 * Injectable fetch so the tests never touch the network -- the previous
 * generation of tests in this project reached real services and a real
 * database, and both cost a debugging session.
 */
export async function probePublicUrl(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<ProbeOutcome> {
  const url = `${baseUrl.replace(/\/$/, "")}/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      headers: WATCH_HEADERS,
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type");
    const text = await response.text();
    const bodyStart = text.slice(0, 200);

    let reach = classify(response.status);

    // A 200 is not enough. The store bug and the pairing bug were both a 200 or
    // a 404 carrying HTML, and the watch's failure is a PARSE failure, not a
    // status failure -- so grade the body, not the code.
    if (reach === "ok") {
      try {
        const parsed = JSON.parse(text) as { service?: string };
        if (parsed.service !== "trainbud") {
          reach = "not_server";
        }
      } catch {
        reach = "not_server";
      }
    }

    return { reach, status: response.status, contentType, bodyStart };
  } catch (error) {
    return {
      reach: "unreachable",
      status: null,
      contentType: null,
      bodyStart: "",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function describeReach(outcome: ProbeOutcome, url: string): CheckLine {
  switch (outcome.reach) {
    case "ok":
      return {
        name: "Watch can reach this server",
        ok: true,
        detail: `${url}/health answered with TrainBud's own JSON.`,
      };
    case "not_server":
      return {
        name: "Watch can reach this server",
        ok: false,
        detail:
          outcome.status === null
            ? "Something answered, but not with TrainBud's JSON."
            : `${url}/health answered ${outcome.status} with ${outcome.contentType ?? "an unknown content type"}, not TrainBud's JSON. The watch cannot parse this and will report error -400 "Not a TrainBud server". First bytes: ${outcome.bodyStart.slice(0, 120)}`,
        fix: "Your tunnel is answering instead of TrainBud. Restart it, or point Server URL at a tunnel that is actually forwarding to this machine.",
      };
    case "unauthorized":
      return {
        name: "Watch can reach this server",
        ok: false,
        detail: `${url}/health answered ${outcome.status}. Something in front of this server is asking for its own credentials.`,
        fix: "Remove the authentication in front of the tunnel; TrainBud does its own.",
      };
    case "refused":
      return {
        name: "Watch can reach this server",
        ok: false,
        detail: `${url}/health answered 429. Something is rate limiting the watch.`,
        fix: "Wait a minute, then run this again.",
      };
    default:
      return {
        name: "Watch can reach this server",
        ok: false,
        detail: `${url}/health could not be reached: ${outcome.error ?? "no response"}.`,
        fix: "Start your tunnel, and check that it forwards to this machine's port.",
      };
  }
}

export async function runSelfTest(
  fetchImpl: typeof fetch = fetch
): Promise<SelfTestResult> {
  const checks: CheckLine[] = [];
  const publicUrl = appConfig.publicUrl;

  let reach: ReachClass = "not_configured";

  if (!publicUrl) {
    checks.push({
      name: "Public URL",
      ok: false,
      detail: "No public URL is configured, so the watch has no address to call.",
      fix: "Set TRAINBUD_PUBLIC_URL in .env, or pair a watch once so the address is recorded.",
    });
  } else {
    checks.push({
      name: "Public URL",
      ok: true,
      detail: publicUrl,
    });

    const outcome = await probePublicUrl(publicUrl, fetchImpl);
    reach = outcome.reach;
    checks.push(describeReach(outcome, publicUrl));

    if (!publicUrl.startsWith("https://")) {
      checks.push({
        name: "HTTPS",
        ok: false,
        detail: "The public URL is not https.",
        fix: "Connect IQ refuses plain http outright, with error -1001. Use an https URL.",
      });
    }
  }

  const aiReady = isAiConfigured();
  checks.push({
    name: "AI features",
    ok: aiReady,
    warning: !aiReady,
    detail: aiReady
      ? "An Anthropic key is configured, so the Ask card and the daily insight can run."
      : "No Anthropic key. AI is bring-your-own-key, so the Ask card and the daily insight cannot run.",
    fix: aiReady ? undefined : "Paste a key into the AI section of this dashboard.",
  });

  // The detectors' own coverage figure, not a row count: it is the number the
  // 14-day threshold is actually applied to, so the dashboard and the watch
  // cannot disagree about whether there is enough history.
  let historyDays = 0;
  try {
    historyDays = runDetectors().coverage.days;
  } catch {
    historyDays = 0;
  }

  // Fourteen days is the threshold every detector uses before it will compare a
  // day against a baseline, so it is the honest line between "no findings" and
  // "cannot tell yet".
  checks.push({
    name: "History depth",
    ok: historyDays >= 14,
    warning: historyDays > 0 && historyDays < 14,
    detail:
      historyDays >= 14
        ? `${historyDays} days stored, enough to compare a day against your own baselines.`
        : `${historyDays} days stored; 14 are needed before anything can be compared against a baseline.`,
    fix: historyDays >= 14 ? undefined : "Run `trainbud backfill --days 365`.",
  });

  const pending = getPendingPairings().length;
  if (pending > 0) {
    checks.push({
      name: "Pairing",
      ok: true,
      warning: true,
      detail: `${pending} pairing code(s) waiting for approval.`,
      fix: "Approve the code shown on your watch in the Pairing section.",
    });
  }

  return {
    reach,
    publicUrl,
    checks,
    ok: checks.every((check) => check.ok),
  };
}
