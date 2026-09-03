import type { GarminConnectInstance } from "./garminConnect.js";
import { authenticateGarmin } from "./auth.js";
import { logger } from "../utils/logger.js";
import { GarminApiError } from "./types.js";

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
let authBlockedUntil: number | null = null;

function remainingCooldownSeconds(): number {
  if (authBlockedUntil === null) {
    return 0;
  }
  return Math.max(0, Math.ceil((authBlockedUntil - Date.now()) / 1000));
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
      `Garmin sign-in is rate limited. Retry in about ${cooldown} seconds.`,
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
async function trackAuthRateLimit(
  login: () => Promise<GarminConnectInstance>
): Promise<GarminConnectInstance> {
  try {
    const client = await login();
    authBlockedUntil = null;
    return client;
  } catch (error) {
    const rateLimited = toRateLimitError(error);
    if (rateLimited) {
      authBlockedUntil = Date.now() + (rateLimited.retryAfterSeconds ?? 60) * 1000;
      throw rateLimited;
    }
    throw error;
  }
}

export function resetGarminClient(): void {
  clientInstance = null;
  clientPromise = null;
  authBlockedUntil = null;
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

  const message = error.message.toLowerCase();
  if (!message.includes("429") && !message.includes("rate limit")) {
    return null;
  }

  return new GarminApiError("Garmin rate limit reached. Retry in about 60 seconds.", 429, 60);
}

export async function withGarminClient<T>(
  operation: (client: GarminConnectInstance) => Promise<T>
): Promise<T> {
  try {
    const client = await getGarminClient(false);
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
    resetGarminClient();
    const client = await getGarminClient(true);
    return await operation(client);
  }
}
