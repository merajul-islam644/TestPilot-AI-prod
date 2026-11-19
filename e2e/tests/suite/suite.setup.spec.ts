import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { testConfig } from "../../lib/config";
import { LoginPage } from "../../pages/LoginPage";

// Runs in the "data-setup" project, which every menu suite ("data" project)
// depends on. Signs in through the hosted Blocks IAM and OVERWRITES the
// shared session file that the data project uses as its storageState. The
// config only checks that the file exists at startup (a committed
// placeholder is enough); each data test reads it again when its own
// context is created — so every menu test gets THIS run's fresh session,
// not the placeholder.
test.describe("data suite setup", () => {
  test("sign in through hosted Blocks IAM and persist the shared session", async ({ page, context }) => {
    test.setTimeout(180_000);
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
      await expect(page.getByRole("navigation", { name: "TestPilot" })).toBeVisible({ timeout: 45_000 });
      fs.mkdirSync(path.dirname(testConfig.storageStatePath), { recursive: true });
      await context.storageState({ path: testConfig.storageStatePath });
    });
  });
});
