import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// e2e/.env is optional — real environment variables always win over it.
const envFile = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
try {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !(match[1]! in process.env)) {
      process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // No .env file — fall back to whatever the process environment carries.
}

export const testConfig = {
  /** Deployed app under test. */
  baseURL: process.env.E2E_BASE_URL ?? "https://dbycry-erkzk.slsblx.com",
  /** Blocks IAM account used by the login setup. */
  email: process.env.E2E_EMAIL ?? "",
  password: process.env.E2E_PASSWORD ?? "",
  /** Session file written by tests/auth.setup.ts (relative to this folder). */
  storageStatePath: join(dirname(fileURLToPath(import.meta.url)), "..", ".auth", "user.json")
};
