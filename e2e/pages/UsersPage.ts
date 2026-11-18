import { expect, type Locator, type Page } from "@playwright/test";
import { BasePage } from "./BasePage";

export class UsersPage extends BasePage {
  readonly refreshButton: Locator;
  readonly inviteButton: Locator;
  readonly searchInput: Locator;
  readonly statusFilter: Locator;
  readonly roleFilter: Locator;
  readonly organizationFilter: Locator;
  readonly usersTable: Locator;
  readonly userCount: Locator;
  readonly pageIndicator: Locator;

  constructor(page: Page) {
    super(page, "/users", "Users");
    this.refreshButton = this.main.getByRole("button", { name: "Refresh" });
    this.inviteButton = this.main.getByRole("button", { name: "Invite user" });
    this.searchInput = this.main.getByPlaceholder("Search by name or email…");
    this.statusFilter = this.main.getByRole("combobox", { name: /Status/ });
    this.roleFilter = this.main.getByRole("combobox", { name: /Role/ });
    this.organizationFilter = this.main.getByRole("combobox", { name: /Organization/ });
    this.usersTable = this.main.getByRole("table");
    this.userCount = this.main.getByText(/^\d+ users?$/);
    this.pageIndicator = this.main.getByText(/^Page \d+ of \d+$/);
  }

  columnHeader(name: string): Locator {
    return this.usersTable.getByRole("columnheader", { name, exact: true });
  }

  /** Row of the signed-in user — it carries the "You" badge. */
  ownRow(): Locator {
    return this.usersTable.getByRole("row").filter({ hasText: "You" });
  }
}
