import { expect, test } from "./fixtures";
import { IssuesPage } from "../pages/IssuesPage";

test.describe("Issues menu", () => {
  test("covers the Issues view end to end", async ({ page }) => {
    const issues = new IssuesPage(page);

    await test.step("open Issues from the sidebar", async () => {
      await issues.openViaSidebar("Issues");
    });

    await test.step("search box and severity/project filters are visible", async () => {
      await expect(issues.searchInput).toBeVisible();
      await expect(issues.severityFilter).toBeVisible();
      await expect(issues.projectFilter).toBeVisible();
    });

    await test.step("All is the default status tab", async () => {
      await expect(issues.statusTab("All")).toBeChecked();
    });

    await test.step("issues render as a table or the empty state", async () => {
      await issues.expectListOrEmptyState();
    });

    await test.step("selecting the Resolved tab updates the selection", async () => {
      await issues.statusTab("Resolved").click();
      await expect(issues.statusTab("Resolved")).toBeChecked();
      await expect(issues.statusTab("All")).not.toBeChecked();
    });

    await test.step("selecting the Open tab updates the selection", async () => {
      await issues.statusTab("Open").click();
      await expect(issues.statusTab("Open")).toBeChecked();
    });

    await test.step("returning to All restores the default tab", async () => {
      await issues.statusTab("All").click();
      await expect(issues.statusTab("All")).toBeChecked();
    });

    await test.step("typing a query that matches nothing settles the list", async () => {
      await issues.searchInput.fill("no-such-issue-query");
      await issues.expectListOrEmptyState();
    });
  });
});
