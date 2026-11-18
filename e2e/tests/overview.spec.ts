import { expect, test } from "./fixtures";
import { OverviewPage } from "../pages/OverviewPage";
import { ProjectsPage } from "../pages/ProjectsPage";

test.describe("Overview menu", () => {
  test("covers the Overview dashboard end to end", async ({ page }) => {
    const overview = new OverviewPage(page);

    await test.step("open Overview from the sidebar", async () => {
      await overview.openViaSidebar("Overview");
    });

    await test.step("shows the four health stat cards", async () => {
      for (const label of ["Total tests", "Passed", "Failed", "Success rate"] as const) {
        await expect(overview.statLabel(label)).toBeVisible();
      }
    });

    await test.step("shows activity, project health and recent-runs panels", async () => {
      await expect(overview.panelHeading("Test activity")).toBeVisible();
      await expect(overview.panelHeading("Project health")).toBeVisible();
      await expect(overview.panelHeading("Recent test runs")).toBeVisible();
    });

    await test.step("recent-runs table renders its columns", async () => {
      const table = overview.recentRunsTable();
      await expect(table.getByRole("columnheader", { name: "Project", exact: true })).toBeVisible();
      await expect(table.getByRole("columnheader", { name: "Status", exact: true })).toBeVisible();
      await expect(table.getByRole("columnheader", { name: "Passing rate", exact: true })).toBeVisible();
    });

    await test.step("branch-and-runs control strip is present", async () => {
      await expect(overview.recheckFoldersButton()).toBeVisible();
    });

    await test.step("30 days is the default activity range", async () => {
      await expect(overview.rangeRadio("30 days")).toBeChecked();
    });

    await test.step("switching to 7 days updates the selection", async () => {
      await overview.rangeRadio("7 days").click();
      await expect(overview.rangeRadio("7 days")).toBeChecked();
      await expect(overview.rangeRadio("30 days")).not.toBeChecked();
    });

    await test.step("switching back to 30 days restores the default", async () => {
      await overview.rangeRadio("30 days").click();
      await expect(overview.rangeRadio("30 days")).toBeChecked();
    });

    await test.step("sidebar round-trip through Projects lands back here", async () => {
      await overview.sidebarLink("Projects").click();
      await expect(new ProjectsPage(page).heading).toBeVisible();
      await overview.sidebarLink("Overview").click();
      await expect(overview.heading).toBeVisible();
    });
  });
});
