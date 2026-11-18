import { expect, test } from "./fixtures";
import { SuitesPage } from "../pages/SuitesPage";

test.describe("Test suites menu", () => {
  test("covers the Test suites view end to end", async ({ page }) => {
    const suites = new SuitesPage(page);

    await test.step("open Test suites from the sidebar", async () => {
      await suites.openViaSidebar("Test suites");
    });

    await test.step("All is the default status tab and all four tabs exist", async () => {
      await expect(suites.statusTab("All")).toBeChecked();
      for (const tab of ["Active", "Draft", "Archived"] as const) {
        await expect(suites.statusTab(tab)).toBeVisible();
      }
    });

    await test.step("project filter combobox is visible", async () => {
      await expect(suites.projectFilter).toBeVisible();
    });

    await test.step("suites render as rows or the no-workspace empty state", async () => {
      await suites.expectListOrEmptyState();
    });

    await test.step("selecting the Draft tab updates the selection", async () => {
      await suites.statusTab("Draft").click();
      await expect(suites.statusTab("Draft")).toBeChecked();
      await expect(suites.statusTab("All")).not.toBeChecked();
    });

    await test.step("selecting the Archived tab updates the selection", async () => {
      await suites.statusTab("Archived").click();
      await expect(suites.statusTab("Archived")).toBeChecked();
    });

    await test.step("returning to All restores the default tab", async () => {
      await suites.statusTab("All").click();
      await expect(suites.statusTab("All")).toBeChecked();
    });
  });
});
