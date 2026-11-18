import { expect, test } from "./fixtures";
import { OrganizationsPage } from "../pages/OrganizationsPage";

test.describe("Organizations menu", () => {
  test("covers the Organizations admin view end to end", async ({ page }) => {
    const orgs = new OrganizationsPage(page);

    await test.step("open Organizations from the sidebar", async () => {
      await orgs.openViaSidebar("Organizations");
    });

    await test.step("Refresh and Create organization actions are visible", async () => {
      await expect(orgs.refreshButton).toBeVisible();
      await expect(orgs.createOrganizationButton).toBeVisible();
    });

    await test.step("the table renders with its column headers", async () => {
      for (const column of ["Name", "Description", "Contact email", "Website", "Actions"] as const) {
        await expect(orgs.columnHeader(column)).toBeVisible();
      }
      await expect(orgs.organizationsTable.getByRole("row").first()).toBeVisible();
    });

    await test.step("the Organization policy panel renders its switches", async () => {
      await expect(orgs.policyHeading("Organization policy")).toBeVisible();
      for (const name of ["Multi-org members", "Unique organization names", "Creation from signup"] as const) {
        await expect(orgs.policySwitch(name)).toBeVisible();
      }
    });

    await test.step("Save stays disabled until a policy actually changes", async () => {
      const saveButton = orgs.main.getByRole("button", { name: "Save" }).first();
      await expect(saveButton).toBeDisabled();
    });

    await test.step("the Signup policy panel renders", async () => {
      await expect(orgs.policyHeading("Signup policy")).toBeVisible();
      await expect(orgs.policySwitch("Email & password signup")).toBeVisible();
      await expect(orgs.policySwitch("SSO signup")).toBeVisible();
    });
  });
});
