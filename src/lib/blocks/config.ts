export const blocksConfig = {
  apiUrl: import.meta.env.VITE_BLOCKS_API_URL as string,
  appDomain: import.meta.env.VITE_BLOCKS_APP_DOMAIN as string,
  oidcUrl: import.meta.env.VITE_BLOCKS_OIDC_URL as string,
  oidcClientId: (import.meta.env.VITE_BLOCKS_OIDC_CLIENT_ID as string) || "",
  oidcScope: (import.meta.env.VITE_BLOCKS_OIDC_SCOPE as string) || "openid profile",
  // This project's tenant id -- sent as the x-blocks-key header on every
  // Blocks API call, and as tenant_id on the OIDC login request.
  xBlocksKey: import.meta.env.VITE_BLOCKS_X_BLOCKS_KEY as string
};

export function isBlocksConfigured(): boolean {
  return Boolean(blocksConfig.apiUrl && blocksConfig.xBlocksKey && blocksConfig.appDomain);
}

export function isLoginConfigured(): boolean {
  return Boolean(blocksConfig.apiUrl && blocksConfig.oidcUrl && blocksConfig.oidcClientId);
}
