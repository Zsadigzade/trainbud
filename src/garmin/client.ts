import type { GarminConnectInstance } from "./garminConnect.js";
import { authenticateGarmin } from "./auth.js";
import { logger } from "../utils/logger.js";
import { GarminApiError } from "./types.js";
import { deleteSetting, getSetting, setSetting } from "../appDb.js";

// SECTION: Garmin Client Singleton

let clientInstance: GarminConnectInstance | null = null;
let clientPromise: Promise<GarminConnectInstance> | null = null;

/**
 * When a rate-limited login stops being retried.
 *
 * Garmin's SSO sits behind Cloudflare, which answers a burst of logins with a
 * 429 that says, in the body, "wait at least 30 seconds, then retry with
 * exponential backoff". Nothing here read that. The in-flight login promise is
 * deliberately cleared on failure -- so that fixing a bad password does not
 * require a restart -- and the consequence was that every subsequent caller
 * started a fresh login of its own. `trainbud check` walks nine tools in
 * sequence, so one expired session became nine logins into a rate limit in
 * about five seconds, each one deepening it, each one dumping a kilobyte of
 * Cloudflare JSON into the log. The command that exists to tell you what is
 * wrong was reliably causing it.
 *
 * One shared cooldown, honoured before any login is attempted. Failing fast
 * with the reason is both faster and kinder to the upstream than nine identical
 * failures.
 */
const COOLDOWN_UNTIL_KEY = "garmin_auth_blocked_until";
const COOLDOWN_STEP_KEY = "garmin_auth_backoff_seconds";

/** Cloudflare's own floor for this limit, from the 1015 body. */
const MIN_COOLDOWN_SECONDS = 60;
/** Past this, waiting longer is not the problem and something else is wrong. */
const MAX_COOLDOWN_SECONDS = 30 * 60;

/**
 * The cooldown has to outlive the process.
 *
 * It was a module variable, which protects a single `trainbud serve` and does
 * nothing at all for the CLI: every `trainbud backfill` is a new process, so it
 * started with no memory of the limit, attempted a fresh login, and was refused
 * again. Running the command a few times in a row is the single most natural
 * thing for a user to do when it fails, and it was the exact behaviour that kept
 * Garmin's login limit alive. Observed doing precisely that.
 *
 * Stored in the settings table, which every entry point already opens.
 *
 * The window doubles each time the limit is hit again, because that is what the
 * upstream asks for in the 1015 body: "wait at least 30 seconds, then retry with
 * exponential backoff". A fixed 60 seconds ignores an escalating block and walks
 * straight back into it.
 */
function readCooldownUntil(): number | null {
  const stored = getSetting(COOLDOWN_UNTIL_KEY);
  if (!stored) {
    return null;
  }
  const value = Number.parseInt(stored, 10);
  return Number.isFinite(value) ? value : null;
}

function remainingCooldownSeconds(): number {
  const until = readCooldownUntil();
  if (until === null) {
    return 0;
  }
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

function startCooldown(upstreamRetryAfter: number | null): number {
  const previous = Number.parseInt(getSetting(COOLDOWN_STEP_KEY) ?? "", 10);
  const base = Number.isFinite(previous) && previous > 0 ? previous * 2 : MIN_COOLDOWN_SECONDS;
  const seconds = Math.min(
    MAX_COOLDOWN_SECONDS,
    Math.max(base, upstreamRetryAfter ?? 0, MIN_COOLDOWN_SECONDS)
  );

  setSetting(COOLDOWN_UNTIL_KEY, String(Date.now() + seconds * 1000));
  setSetting(COOLDOWN_STEP_KEY, String(seconds));
  return seconds;
}

function clearCooldown(): void {
  deleteSetting(COOLDOWN_UNTIL_KEY);
  deleteSetting(COOLDOWN_STEP_KEY);
}

/** Injectable for tests; production always authenticates for real. */
export type Authenticator = (force: boolean) => Promise<GarminConnectInstance>;

const defaultAuthenticator: Authenticator = (force) => authenticateGarmin(force);

export async function getGarminClient(
  forceAuth = false,
  authenticator: Authenticator = defaultAuthenticator
): Promise<GarminConnectInstance> {
  // An existing session is still usable while the login endpoint is cooling
  // down: the cooldown is about signing in again, not about the API.
  if (clientInstance && !forceAuth) {
    return clientInstance;
  }

  const cooldown = remainingCooldownSeconds();
  if (cooldown > 0) {
    throw new GarminApiError(
      `Garmin is rate limiting sign-in. ${cooldown}s left to wait — every attempt before then extends it.`,
      429,
      cooldown
    );
  }

  if (forceAuth) {
    clientInstance = await trackAuthRateLimit(() => authenticator(true));
    clientPromise = Promise.resolve(clientInstance);
    return clientInstance;
  }

  if (!clientPromise) {
    // The in-flight promise is memoised so concurrent callers share one login.
    // It used to be memoised on failure too: a single bad password poisoned
    // every later call with the same rejected promise, so fixing the
    // credentials changed nothing until the process was restarted. Clear it on
    // rejection and let the next caller try again.
    clientPromise = trackAuthRateLimit(() => authenticator(false))
      .then((client) => {
        clientInstance = client;
        return client;
      })
      .catch((error: unknown) => {
        clientPromise = null;
        throw error;
      });
  }

  return clientPromise;
}

/**
 * Runs a login and records a cooldown if the upstream rate limited it.
 *
 * The window comes from the error itself where the upstream supplied one, so a
 * server that asks for longer gets longer. Cleared on success, so a login that
 * works immediately after the window costs nothing.
 */
/**
 * Runs a login without letting the upstream library print to the console.
 *
 * garmin-connect's handleHttpError does `console.error(msg)` and then
 * `throw new Error(msg)` with the same string, so the kilobyte of Cloudflare
 * 1015 JSON a user sees is a duplicate of an error we already catch and render
 * as one actionable line. Printed first and unconditionally, it buried that line
 * and made a "wait 60 seconds" look like a crash -- and the natural response to
 * a crash is to run the command again, which extends the block.
 *
 * Kept at debug level rather than dropped: it is still the upstream's own
 * account of what happened, and LOG_LEVEL=debug brings it back.
 */
async function withQuietUpstreamErrors<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = (...args: unknown[]): void => {
    logger.debug({ upstream: args.map(String).join(" ") }, "garmin-connect console output");
  };
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}

async function trackAuthRateLimit(
  login: () => Promise<GarminConnectInstance>
): Promise<GarminConnectInstance> {
  try {
    const client = await withQuietUpstreamErrors(login);
    clearCooldown();
    return client;
  } catch (error) {
    const rateLimited = toRateLimitError(error);
    if (rateLimited) {
      const seconds = startCooldown(rateLimited.retryAfterSeconds ?? null);
      throw new GarminApiError(
        `Garmin is rate limiting sign-in. Waiting ${seconds}s before the next attempt; retrying sooner makes it last longer.`,
        429,
        seconds
      );
    }
    throw error;
  }
}

/**
 * Forget the session. NOT the rate limit.
 *
 * These were one function, and the retry path in `withGarminClient` called it
 * -- so the single code path reached by exactly the failure the cooldown exists
 * for was the one that deleted the cooldown, and then attempted a fresh login
 * into the live block. The doubling could never escalate past its 60-second
 * floor either, because every failure reset the ladder to the bottom rung.
 *
 * Two different jobs had been sharing one name: `trainbud auth` wants both
 * forgotten, since the user has just supplied new credentials and is entitled
 * to one attempt. A failed request wants only the session forgotten.
 */
export function resetGarminSession(): void {
  clientInstance = null;
  clientPromise = null;
}

/** Forget the session AND the rate limit. What `trainbud auth` asks for. */
export function resetGarminClient(): void {
  resetGarminSession();
  clearCooldown();
}

function isAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("401") ||
    message.includes("403") ||
    message.includes("unauthorized") ||
    message.includes("token") ||
    message.includes("login failed")
  );
}

function toRateLimitError(error: unknown): GarminApiError | null {
  if (!(error instanceof Error)) {
    return null;
  }

  // Already ours: it carries the real remaining cooldown, which is the number
  // the user needs. Re-wrapping it replaced that with a hardcoded 60 seconds and
  // told someone eight minutes into an escalated block to try again in one.
  if (error instanceof GarminApiError && error.statusCode === 429) {
    return error;
  }

  const message = error.message.toLowerCase();
  if (!message.includes("429") && !message.includes("rate limit")) {
    return null;
  }

  // Cloudflare puts the wait in the body it just sent us. Reading it beats
  // guessing, and it is the difference between honouring an escalating block and
  // walking back into it.
  const retryAfter = /"retry_after"\s*:\s*(\d+)/.exec(error.message)?.[1];
  const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : 60;

  return new GarminApiError(
    `Garmin rate limit reached. Retry in about ${seconds} seconds.`,
    429,
    Number.isFinite(seconds) ? seconds : 60
  );
}

export async function withGarminClient<T>(
  operation: (client: GarminConnectInstance) => Promise<T>,
  authenticator: Authenticator = defaultAuthenticator
): Promise<T> {
  try {
    const client = await getGarminClient(false, authenticator);
    return await operation(client);
  } catch (error) {
    const rateLimitError = toRateLimitError(error);
    if (rateLimitError) {
      throw rateLimitError;
    }

    if (!isAuthError(error)) {
      throw error;
    }

    logger.warn({ error }, "Garmin request failed auth, retrying once");

    // The session, not the cooldown. This used to call `resetGarminClient`,
    // which deletes both -- so the retry erased a live rate-limit block and
    // walked straight back into it, on the single path the block exists to
    // guard. With the cooldown left in place, the `getGarminClient` call below
    // refuses on its own: its cooldown check runs ahead of the `forceAuth`
    // branch, so no extra guard is needed here and adding one would put the
    // same decision in two places.
    resetGarminSession();

    const client = await getGarminClient(true, authenticator);
    return await operation(client);
  }
}
