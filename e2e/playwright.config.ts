import fs from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { testConfig } from "./lib/config";

// Shape matters: this mirrors the config the TestPilot runner generates for
// "repo-shaped" suites (all specs under tests/, projects setup → data-setup
// → data → data-teardown, storageState from fixtures/data-session.json) so
// terminal runs (`npm test` here) and in-app runs through the runner execute
// the same project graph. See runner/server.mjs buildConfig().
export default defineConfig({
  testDir: "./tests",
  outputDir: "./artifacts/test-results",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  reporter: [["list"], ["html", { open: "never", outputFolder: "./artifacts/playwright-report" }]],
  use: {
    baseURL: testConfig.baseURL,
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  expect: { timeout: 10_000 },
  projects: [
    // Login-flow smoke test. Deliberately no storageState — it must see the
    // unauthenticated gate. (No login.spec.ts ships yet, so this project
    // matches nothing today; kept for shape parity with the runner.)
    {
      name: "setup",
      testMatch: /auth[/]login\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] }
    },
    // Signs in once and refreshes fixtures/data-session.json.
    {
      name: "data-setup",
      testMatch: /suite\.setup\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] }
    },
    // Every menu suite, signed in via the session data-setup refreshed.
    {
      name: "data",
      testMatch: /.*\.spec\.ts/,
      testIgnore: [/auth[/]login\.spec\.ts/, /suite\.(setup|teardown)\.spec\.ts/],
      dependencies: ["data-setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        ...(fs.existsSync(testConfig.storageStatePath)
          ? { storageState: testConfig.storageStatePath }
          : {})
      }
    },
    // No teardown spec ships today; kept for shape parity with the runner.
    {
      name: "data-teardown",
      testMatch: /suite\.teardown\.spec\.ts/,
      dependencies: ["data"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        ...(fs.existsSync(testConfig.storageStatePath)
          ? { storageState: testConfig.storageStatePath }
          : {})
      }
    }
  ]
});
