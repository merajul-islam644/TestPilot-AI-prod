import { expect, test } from "./fixtures";
import { RunsPage } from "../pages/RunsPage";

test.describe("Test runs menu", () => {
  test("covers the Test runs list end to end", async ({ page }) => {
    const runs = new RunsPage(page);

    await test.step("open Test runs from the sidebar", async () => {
      await runs.openViaSidebar("Test runs");
    });

    await test.step("search box and project/status filters are visible", async () => {
      await expect(runs.searchInput).toBeVisible();
      await expect(runs.projectFilter).toBeVisible();
      await expect(runs.statusFilter).toBeVisible();
    });

    await test.step("runs render as a table or the filtered-empty state", async () => {
      await runs.expectListOrEmptyState();
    });

    await test.step("typing a query that matches nothing settles the list", async () => {
      await runs.searchInput.fill("no-such-run-query");
      await runs.expectListOrEmptyState();
    });

    await test.step("clearing the query restores the full list", async () => {
      await runs.searchInput.fill("");
      await runs.expectListOrEmptyState();
    });

    await test.step("status dropdown opens with its options", async () => {
      await runs.statusFilter.click();
      await expect(runs.statusOption("All statuses")).toBeVisible();
    });

    await test.step("Escape closes the dropdown", async () => {
      await page.keyboard.press("Escape");
      await expect(runs.statusOption("All statuses")).toHaveCount(0);
    });
  });
});
