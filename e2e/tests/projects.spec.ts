import { expect, test } from "./fixtures";
import { ProjectsPage } from "../pages/ProjectsPage";

test.describe("Projects menu", () => {
  test("covers the Projects list end to end", async ({ page }) => {
    const projects = new ProjectsPage(page);

    await test.step("open Projects from the sidebar", async () => {
      await projects.openViaSidebar("Projects");
    });

    await test.step("header and New project button are visible", async () => {
      await expect(projects.heading).toBeVisible();
      await expect(projects.newProjectButton).toBeVisible();
    });

    await test.step("workspace renders project cards or an explicit empty state", async () => {
      await projects.expectListOrEmptyState();
    });

    await test.step("deep-linking to /projects lands on the same page", async () => {
      await projects.open();
      await expect(projects.heading).toBeVisible();
      await expect(projects.newProjectButton).toBeVisible();
    });
  });
});
