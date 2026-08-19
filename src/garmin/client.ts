import type { GarminConnectInstance } from "./garminConnect.js";
import { authenticateGarmin } from "./auth.js";
import { logger } from "../utils/logger.js";
import { GarminApiError } from "./types.js";

// SECTION: Garmin Client Singleton

let clientInstance: GarminConnectInstance | null = null;
let clientPromise: Promise<GarminConnectInstance> | null = null;

/** Injectable for tests; production always authenticates for real. */
export type Authenticator = (force: boolean) => Promise<GarminConnectInstance>;

const defaultAuthenticator: Authenticator = (force) => authenticateGarmin(force);

export async function getGarminClient(
  forceAuth = false,
  authenticator: Authenticator = defaultAuthenticator
): Promise<GarminConnectInstance> {
  if (forceAuth) {
    clientInstance = await authenticator(true);
    clientPromise = Promise.resolve(clientInstance);
    return clientInstance;
  }

  if (clientInstance) {
    return clientInstance;
  }

  if (!clientPromise) {
    // The in-flight promise is memoised so concurrent callers share one login.
    // It used to be memoised on failure too: a single bad password poisoned
    // every later call with the same rejected promise, so fixing the
    // credentials changed nothing until the process was restarted. Clear it on
    // rejection and let the next caller try again.
    clientPromise = authenticator(false)
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

export function resetGarminClient(): void {
  clientInstance = null;
  clientPromise = null;
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
