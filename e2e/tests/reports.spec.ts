import { expect, test } from "./fixtures";
import { ReportsPage } from "../pages/ReportsPage";

test.describe("Reports menu", () => {
  test("covers the Reports view end to end", async ({ page }) => {
    const reports = new ReportsPage(page);

    await test.step("open Reports from the sidebar", async () => {
      await reports.openViaSidebar("Reports");
    });

    await test.step("all five report sections are present", async () => {
      for (const section of [
        "Pass rate",
        "Executions",
        "Failures per day",
        "Success rate by project",
        "Most frequently failing tests"
      ] as const) {
        await expect(reports.sectionHeading(section)).toBeVisible();
      }
    });

    await test.step("Last 30 days is the default range", async () => {
      await expect(reports.rangeRadio("Last 30 days")).toBeChecked();
    });

    await test.step("switching to Last 60 days updates the selection", async () => {
      await reports.rangeRadio("Last 60 days").click();
      await expect(reports.rangeRadio("Last 60 days")).toBeChecked();
      await expect(reports.rangeRadio("Last 30 days")).not.toBeChecked();
    });

    await test.step("switching back restores the default range", async () => {
      await reports.rangeRadio("Last 30 days").click();
      await expect(reports.rangeRadio("Last 30 days")).toBeChecked();
    });

    await test.step("flipping the first chart to table view works", async () => {
      const executionsToggle = reports.showTableViewButtons().first();
      await executionsToggle.click();
      await expect(reports.sectionHeading("Executions")).toBeVisible();
    });

    await test.step("flipping it back to chart view works", async () => {
      const chartToggle = reports.main.getByRole("button", { name: "Show chart view" }).first();
      await chartToggle.click();
      await expect(reports.main.getByRole("button", { name: "Show table view" }).first()).toBeVisible();
    });
  });
});
