import { expect, type Locator, type Page } from "@playwright/test";
import { BasePage } from "./BasePage";

export type IssueStatusTab = "All" | "Open" | "In progress" | "Resolved";

export class IssuesPage extends BasePage {
  readonly searchInput: Locator;
  readonly severityFilter: Locator;
  readonly projectFilter: Locator;
  readonly emptyState: Locator;
  readonly issuesTable: Locator;

  constructor(page: Page) {
    super(page, "/issues", "Issues");
    this.searchInput = this.main.getByPlaceholder("Search issues");
    this.severityFilter = this.main.getByRole("combobox", { name: "Severity" });
    this.projectFilter = this.main.getByRole("combobox", { name: "Project" });
    this.emptyState = this.main.locator(".empty-state");
    this.issuesTable = this.main.getByRole("table");
  }

  statusTab(name: IssueStatusTab): Locator {
    return this.main.getByRole("radio", { name, exact: true });
  }

  async expectListOrEmptyState(): Promise<void> {
    await expect(this.issuesTable.or(this.emptyState).first()).toBeVisible();
  }
}
