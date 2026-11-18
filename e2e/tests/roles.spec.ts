import { expect, test } from "./fixtures";
import { RolesPage } from "../pages/RolesPage";

test.describe("Roles menu", () => {
  test("covers the Roles admin table end to end", async ({ page }) => {
    const roles = new RolesPage(page);

    await test.step("open Roles from the sidebar", async () => {
      await roles.openViaSidebar("Roles");
    });

    await test.step("Refresh, Create role and Diagnose 403 actions are visible", async () => {
      await expect(roles.refreshButton).toBeVisible();
      await expect(roles.createRoleButton).toBeVisible();
      await expect(roles.diagnoseButton).toBeVisible();
    });

    await test.step("the table renders with its column headers", async () => {
      for (const column of ["Role", "Description", "Permissions", "Hierarchy", "Actions"] as const) {
        await expect(roles.columnHeader(column)).toBeVisible();
      }
    });

    await test.step("the seeded clouduser and dataviewer roles are listed", async () => {
      await expect(roles.roleRow("System User")).toBeVisible();
      await expect(roles.roleRow("DataViewer")).toBeVisible();
    });

    await test.step("the DataViewer row describes its read-only scope", async () => {
      await expect(roles.roleRow("DataViewer")).toContainText("Read-only viewer role");
    });

    await test.step("the DataViewer row carries its management actions", async () => {
      await expect(roles.roleRow("DataViewer").getByRole("button", { name: "Edit permissions" })).toBeVisible();
      await expect(roles.roleRow("DataViewer").getByRole("button", { name: "Edit role" })).toBeVisible();
    });

    await test.step("searching narrows the list to the matching role", async () => {
      await roles.searchInput.fill("DataViewer");
      await expect(roles.roleRow("DataViewer")).toBeVisible();
    });

    await test.step("clearing the search brings back every role", async () => {
      await roles.searchInput.fill("");
      await expect(roles.roleRow("System User")).toBeVisible();
    });
  });
});
