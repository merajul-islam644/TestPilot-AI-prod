import { expect, type Locator, type Page } from "@playwright/test";
import { BasePage } from "./BasePage";

export class RunsPage extends BasePage {
  readonly searchInput: Locator;
  readonly projectFilter: Locator;
  readonly statusFilter: Locator;
  readonly emptyState: Locator;
  readonly runsTable: Locator;

  constructor(page: Page) {
    super(page, "/runs", "Test runs");
    this.searchInput = this.main.getByPlaceholder("Search runs");
    this.projectFilter = this.main.getByRole("combobox", { name: "Project" });
    this.statusFilter = this.main.getByRole("combobox", { name: "Status" });
    this.emptyState = this.main.locator(".empty-state");
    this.runsTable = this.main.getByRole("table");
  }

  /** Select options render in a Radix portal at the body level, outside main. */
  statusOption(name: string): Locator {
    return this.page.getByRole("option", { name });
  }

  /** Runs appear as a table once any exist; until then an empty state shows. */
  async expectListOrEmptyState(): Promise<void> {
    await expect(this.runsTable.or(this.emptyState).first()).toBeVisible();
  }
}
