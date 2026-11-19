import { expect, test } from "./fixtures";
import { SettingsPage } from "../pages/SettingsPage";

test.describe("Settings page", () => {
  test("covers the stacked settings sections end to end", async ({ page }) => {
    const settings = new SettingsPage(page);

    await test.step("open Settings from the sidebar", async () => {
      await settings.openViaSidebar("Settings");
    });

    await test.step("security, notifications and appearance render stacked on one page", async () => {
      await expect(settings.sectionHeading("Security")).toBeVisible();
      await expect(settings.sectionHeading("Notifications")).toBeVisible();
      await expect(settings.sectionHeading("Appearance")).toBeVisible();
    });

    await test.step("the security card shows the MFA panels", async () => {
      await expect(settings.main.getByRole("heading", { name: "Two-factor authentication" })).toBeVisible();
      await expect(settings.main.getByRole("heading", { name: "Tenant MFA policy" })).toBeVisible();
      await expect(settings.main.getByRole("switch", { name: "Enable MFA" })).toBeVisible();
    });

    await test.step("the appearance card shows the theme chooser", async () => {
      await expect(settings.main.getByRole("radiogroup").first()).toBeVisible();
    });
  });
});
