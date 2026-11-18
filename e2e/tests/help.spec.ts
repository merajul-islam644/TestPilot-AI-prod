import { expect, test } from "./fixtures";
import { HelpPage } from "../pages/HelpPage";

test.describe("Help menu", () => {
  test("covers the Help center end to end", async ({ page }) => {
    const help = new HelpPage(page);

    await test.step("open Help from the sidebar", async () => {
      await help.openViaSidebar("Help");
    });

    await test.step("the three get-started steps link onward", async () => {
      for (const step of ["Projects", "Test suites", "Run Tests"] as const) {
        await expect(help.startedStepButton(step)).toBeVisible();
      }
    });

    await test.step("the run-status legend is present", async () => {
      for (const status of ["Passed", "Failed", "Running", "Pending", "Cancelled"] as const) {
        await expect(help.main.getByText(status, { exact: true }).first()).toBeVisible();
      }
    });

    await test.step("Ctrl K is documented in the shortcuts table", async () => {
      await expect(help.shortcutsTable.getByRole("cell", { name: "Ctrl K" })).toBeVisible();
    });

    await test.step("pressing Ctrl K opens the real command palette", async () => {
      await page.keyboard.press("Control+k");
      await expect(page.getByRole("dialog")).toBeVisible();
    });

    await test.step("Escape closes the palette again", async () => {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });

    await test.step("expanding a FAQ question reveals its answer", async () => {
      await help.expandFaq("Where does the data come from?");
    });

    await test.step("the remaining FAQ questions are present", async () => {
      for (const question of ["Who can edit suites?", "How are health labels computed?", "Can I export a report?"] as const) {
        await expect(help.faqItem(question)).toBeVisible();
      }
    });
  });
});
