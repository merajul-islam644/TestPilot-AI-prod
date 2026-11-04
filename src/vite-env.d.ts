/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  readonly VITE_BLOCKS_API_URL: string;
  readonly VITE_BLOCKS_APP_DOMAIN: string;
  readonly VITE_BLOCKS_OIDC_URL: string;
  readonly VITE_BLOCKS_OIDC_CLIENT_ID: string;
  readonly VITE_BLOCKS_OIDC_SCOPE?: string;
  readonly VITE_BLOCKS_X_BLOCKS_KEY: string;
  readonly VITE_BLOCKS_DEV_HOST?: string;
  readonly VITE_BLOCKS_DEV_PORT?: string;
  /** Playwright runner service (runner/server.mjs); defaults to http://localhost:9090. */
  readonly VITE_RUNNER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
