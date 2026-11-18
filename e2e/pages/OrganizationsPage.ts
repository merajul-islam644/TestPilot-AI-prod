import { expect, type Locator, type Page } from "@playwright/test";
import { BasePage } from "./BasePage";

export class OrganizationsPage extends BasePage {
  readonly refreshButton: Locator;
  readonly createOrganizationButton: Locator;
  readonly searchInput: Locator;
  readonly organizationsTable: Locator;

  constructor(page: Page) {
    super(page, "/organizations", "Organizations");
    this.refreshButton = this.main.getByRole("button", { name: "Refresh" });
    this.createOrganizationButton = this.main.getByRole("button", { name: "Create organization" });
    this.searchInput = this.main.getByPlaceholder("Search organizations…");
    this.organizationsTable = this.main.getByRole("table").first();
  }

  columnHeader(name: string): Locator {
    return this.organizationsTable.getByRole("columnheader", { name, exact: true });
  }

  policyHeading(name: "Organization policy" | "Signup policy"): Locator {
    return this.page.getByRole("heading", { name, exact: true });
  }

  policySwitch(name: string): Locator {
    return this.page.getByRole("switch", { name });
  }
}
