import { readFileSync } from "node:fs";

// e2e/.env is optional — real environment variables always win over it.
// Paths here are resolved from the process cwd (the e2e folder for terminal
// runs, the runner's temp project for in-app runs). Deliberately no
// import.meta.url: the TestPilot runner pins its temp project to CommonJS,
// where import.meta throws. When no .env sits beside the cwd (in-app runs)
// the runner has already forwarded the workspace's .env values through the
// process environment, so the fallback covers that case.
const envFile = ".env";
try {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !(match[1]! in process.env)) {
      process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // No .env beside the cwd — fall back to the process environment.
}

export const testConfig = {
  /** Deployed app under test. */
  baseURL: process.env.E2E_BASE_URL ?? "https://dbycry-erkzk.slsblx.com",
  /** Blocks IAM account used by the shared login setup. */
  email: process.env.E2E_EMAIL ?? "",
  password: process.env.E2E_PASSWORD ?? "",
  /** Session file written by tests/suite/suite.setup.spec.ts and read by
   *  the "data" project as its storageState (cwd-relative, so the same
   *  relative path works on disk and inside the runner's temp project). */
  storageStatePath: "fixtures/data-session.json"
};
