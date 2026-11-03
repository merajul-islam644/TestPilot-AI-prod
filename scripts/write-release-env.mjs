#!/usr/bin/env node
// Writes the client-safe Blocks env snapshot into dist for release artifacts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const mode = (process.argv[2] || "dev").trim();
if (!mode) {
  console.error("Usage: node scripts/write-release-env.mjs <environment>");
  process.exit(1);
}

const env = readEnv(mode);
const appDomain = env.VITE_BLOCKS_APP_DOMAIN || "";
const redirectUri = env.VITE_BLOCKS_REDIRECT_URI || callbackUri(appDomain);
const projectKey = env.VITE_BLOCKS_X_BLOCKS_KEY || env.VITE_BLOCKS_PROJECT_KEY || "";

const output = [
  "# SELISE Blocks production/default configuration.",
  "# Only client-safe values belong here. Never put passwords, PTOKs, JWTs,",
  "# refresh tokens, cookies, or client secrets in VITE_-prefixed variables.",
  "",
  `VITE_BLOCKS_API_URL=${env.VITE_BLOCKS_API_URL || ""}`,
  `VITE_BLOCKS_PROJECT_KEY=${projectKey}`,
  `VITE_BLOCKS_X_BLOCKS_KEY=${projectKey}`,
  `VITE_BLOCKS_APP_DOMAIN=${appDomain}`,
  `VITE_BLOCKS_OIDC_URL=${env.VITE_BLOCKS_OIDC_URL || ""}`,
  `VITE_BLOCKS_OIDC_CLIENT_ID=${env.VITE_BLOCKS_OIDC_CLIENT_ID || ""}`,
  `VITE_BLOCKS_OIDC_SCOPE=${env.VITE_BLOCKS_OIDC_SCOPE || "openid profile"}`,
  `VITE_BLOCKS_REDIRECT_URI=${redirectUri}`,
  "VITE_BLOCKS_HOSTED_LOGIN=true",
  ""
].join("\n");

mkdirSync("dist", { recursive: true });
writeFileSync(join("dist", `env.${mode}`), output);
console.log(`Wrote dist/env.${mode}`);

function readEnv(mode) {
  const result = {};
  for (const file of [".env", `.env.${mode}`, ".env.local", `.env.${mode}.local`]) {
    if (!existsSync(file)) continue;
    Object.assign(result, parseEnv(readFileSync(file, "utf8")));
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("VITE_BLOCKS_") || value === undefined) continue;
    result[key] = value;
  }
  return result;
}

function parseEnv(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function callbackUri(appDomain) {
  if (!appDomain) return "";
  const origin = appDomain.startsWith("http://") || appDomain.startsWith("https://")
    ? appDomain.replace(/\/+$/, "")
    : `https://${appDomain.replace(/\/+$/, "")}`;
  return `${origin}/login/callback`;
}
