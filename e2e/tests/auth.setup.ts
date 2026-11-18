import { expect, test } from "@playwright/test";
import { testConfig } from "../lib/config";
import { LoginPage } from "../pages/LoginPage";

// Runs once before the menu suites (playwright.config projects.dependencies).
// Signs in through the hosted Blocks IAM with a fresh context and stores the
// resulting cookies/tokens so every chromium-project test starts signed in.
test("sign in through hosted Blocks IAM and persist the session", async ({ page, context }) => {
  const login = new LoginPage(page);

  await test.step("open the app and land on the login screen", async () => {
    await page.goto("/");
    await login.expectLoginScreen();
  });

  await test.step("start the hosted Blocks login", async () => {
    await login.continueWithBlocks();
  });

  await test.step("submit credentials on the IAM sign-in form", async () => {
    await login.signInOnHostedIam(testConfig.email, testConfig.password);
  });

  await test.step("wait for the app shell and save the session state", async () => {
    await page.waitForURL(`${testConfig.baseURL}/**`);
    await expect(page.getByRole("navigation", { name: "TestPilot AI" })).toBeVisible();
    await context.storageState({ path: testConfig.storageStatePath });
  });
});
