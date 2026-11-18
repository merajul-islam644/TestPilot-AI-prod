import { expect, test } from "./fixtures";
import { testConfig } from "../lib/config";
import { UsersPage } from "../pages/UsersPage";

test.describe("Users menu", () => {
  test("covers the Users admin table end to end", async ({ page }) => {
    const users = new UsersPage(page);

    await test.step("open Users from the sidebar", async () => {
      await users.openViaSidebar("Users");
    });

    await test.step("Refresh and Invite user actions are visible", async () => {
      await expect(users.refreshButton).toBeVisible();
      await expect(users.inviteButton).toBeVisible();
    });

    await test.step("the table renders with its column headers", async () => {
      for (const column of ["Name", "Email", "Roles", "Status", "Actions"] as const) {
        await expect(users.columnHeader(column)).toBeVisible();
      }
      await expect(users.usersTable.getByRole("row").first()).toBeVisible();
    });

    await test.step("search, filters and the page indicator are visible", async () => {
      await expect(users.searchInput).toBeVisible();
      await expect(users.statusFilter).toBeVisible();
      await expect(users.roleFilter).toBeVisible();
      await expect(users.organizationFilter).toBeVisible();
      await expect(users.pageIndicator).toBeVisible();
    });

    await test.step("exactly one row carries the signed-in user's You badge", async () => {
      await expect(users.ownRow()).toHaveCount(1);
    });

    await test.step("the own row offers access management but no self-deactivation", async () => {
      await expect(users.ownRow().getByRole("button", { name: "Manage access" })).toBeVisible();
      await expect(users.ownRow().getByRole("button", { name: "Edit user" })).toBeVisible();
      await expect(users.ownRow().getByRole("button", { name: "Deactivate account" })).toHaveCount(0);
    });

    await test.step("searching by the signed-in email narrows the table to it", async () => {
      await users.searchInput.fill(testConfig.email);
      await expect(users.ownRow()).toHaveCount(1);
      const dataRows = users.usersTable.getByRole("row").filter({ hasText: "@" });
      await expect(dataRows).toHaveCount(1);
    });

    await test.step("clearing the search restores the tenant list", async () => {
      await users.searchInput.fill("");
      await expect(users.userCount).toBeVisible();
    });
  });
});
