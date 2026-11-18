import { expect, test } from "./fixtures";
import { SettingsPage } from "../pages/SettingsPage";

test.describe("Settings menu", () => {
  test("covers the Settings sections end to end", async ({ page }) => {
    const settings = new SettingsPage(page);

    await test.step("open Settings from the sidebar", async () => {
      await settings.openViaSidebar("Settings");
    });

    await test.step("every rail section is present", async () => {
      for (const section of ["General", "Workspace", "Profile", "Security", "Notifications", "Appearance"] as const) {
        await expect(settings.railSection(section)).toBeVisible();
      }
    });

    await test.step("the general section carries the workspace name and Save", async () => {
      await expect(settings.workspaceNameInput()).not.toHaveValue("");
      await expect(settings.main.getByRole("button", { name: "Save" }).first()).toBeVisible();
    });

    await test.step("switching to Security shows MFA panels", async () => {
      await settings.openSection("Security");
      await expect(settings.main.getByRole("heading", { name: "Two-factor authentication" })).toBeVisible();
      await expect(settings.main.getByRole("heading", { name: "Tenant MFA policy" })).toBeVisible();
      await expect(settings.main.getByRole("switch", { name: "Enable MFA" })).toBeVisible();
      await expect(settings.main.getByRole("switch", { name: "Require for all users" })).toBeVisible();
    });

    await test.step("switching to Appearance shows the theme chooser", async () => {
      await settings.openSection("Appearance");
      await expect(settings.main.getByRole("radiogroup").first()).toBeVisible();
    });

    await test.step("the danger zone stays reachable from any section", async () => {
      await expect(settings.dangerZoneResetButton()).toBeVisible();
    });
  });
});
