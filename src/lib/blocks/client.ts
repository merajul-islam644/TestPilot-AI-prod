import { createBlocksClient } from "@seliseblocks/client";
import { blocksConfig } from "./config";
import { forceRefreshAccessToken, getValidAccessToken } from "./auth";

// Single Blocks API entry point for this app -- every Auth, IAM, Data, and
// Localization call goes through this client, never a hand-written fetch().
// `accessToken` is a caller-owned resolver: the SDK reads it before each
// protected call but never stores/refreshes/clears it itself, so the actual
// session lifecycle (storage, refresh-before-expiry) lives in ./auth.ts.
// `onUnauthorized` is the reactive counterpart: it only fires when a call
// comes back 401 despite a locally-valid-looking token (server-side
// revocation, clock skew), and shares the same in-flight refresh as the
// proactive path so concurrent 401s resolve one refresh, not one each.
export const blocksClient = createBlocksClient({
  accessToken: () => getValidAccessToken(),
  apiUrl: blocksConfig.apiUrl,
  appDomain: blocksConfig.appDomain,
  onUnauthorized: () => forceRefreshAccessToken(),
  oidc: {
    clientId: blocksConfig.oidcClientId,
    scope: blocksConfig.oidcScope,
    url: blocksConfig.oidcUrl
  },
  xBlocksKey: blocksConfig.xBlocksKey
});
