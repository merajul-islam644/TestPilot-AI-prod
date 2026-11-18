import { expect, type Locator, type Page } from "@playwright/test";
import { BasePage } from "./BasePage";

export class RolesPage extends BasePage {
  readonly refreshButton: Locator;
  readonly createRoleButton: Locator;
  readonly searchInput: Locator;
  readonly diagnoseButton: Locator;
  readonly rolesTable: Locator;

  constructor(page: Page) {
    super(page, "/roles", "Roles");
    this.refreshButton = this.main.getByRole("button", { name: "Refresh" });
    this.createRoleButton = this.main.getByRole("button", { name: "Create role" });
    this.searchInput = this.main.getByPlaceholder("Search roles…");
    this.diagnoseButton = this.main.getByRole("button", { name: "Diagnose 403" }).first();
    this.rolesTable = this.main.getByRole("table");
  }

  columnHeader(name: string): Locator {
    return this.rolesTable.getByRole("columnheader", { name, exact: true });
  }

  roleRow(name: string): Locator {
    return this.rolesTable.getByRole("row").filter({ hasText: name });
  }
}
