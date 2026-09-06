import { createPairToken, getPairToken, approvePairToken, deletePairToken, listPendingPairTokens, createDeviceToken } from "./appDb.js";
import { appConfig } from "./config.js";
import { defaultDeviceLabel } from "./deviceTokens.js";

// SECTION: Pairing API

export interface PairRequestResult {
  code: string;
  expires_in: number;
}

export interface PairStatusResult {
  approved: boolean;
  api_key?: string;
  server_url?: string;
}

export function requestPairing(): PairRequestResult {
  const token = createPairToken();
  const now = Math.floor(Date.now() / 1000);
  return {
    code: token.code,
    expires_in: token.expires_at - now,
  };
}

// publicUrl is the address the watch should use from now on. It is passed in by
// the HTTP layer, derived from the host the poll actually arrived on, because
// the configured value is a stale file on disk more often than not — see
// resolvePublicUrl in httpServer.ts.
export function checkPairStatus(code: string, publicUrl?: string): PairStatusResult | null {
  const token = getPairToken(code);
  if (!token) return null;

  const now = Math.floor(Date.now() / 1000);
  if (token.expires_at < now) return null;

  if (token.approved_at !== null) {
    deletePairToken(code);

    // What the watch receives here used to be appConfig.mcpApiKey: the master
    // key, handed to a device over a tunnel, with no way to take it back except
    // rotating the key for everything. It is now a token minted for this
    // pairing alone, revocable by itself. The field name is unchanged on
    // purpose -- the watch stores whatever arrives here and sends it as a
    // bearer token, so nothing on the device had to change and no already
    // paired watch has to pair again.
    const device = createDeviceToken(defaultDeviceLabel());
    return {
      approved: true,
      api_key: device.token,
      server_url: publicUrl || appConfig.publicUrl,
    };
  }

  return { approved: false };
}

export function approvePairing(code: string): boolean {
  return approvePairToken(code);
}

export function getPendingPairings() {
  return listPendingPairTokens();
}
