import { expect, type Locator, type Page } from "@playwright/test";
import { BasePage } from "./BasePage";

export type SuiteStatusTab = "All" | "Active" | "Draft" | "Archived";

export class SuitesPage extends BasePage {
  readonly projectFilter: Locator;
  readonly emptyState: Locator;

  constructor(page: Page) {
    super(page, "/suites", "Test suites");
    this.projectFilter = this.main.getByRole("combobox", { name: "Project" });
    this.emptyState = this.main.locator(".empty-state");
  }

  statusTab(name: SuiteStatusTab): Locator {
    return this.main.getByRole("radio", { name, exact: true });
  }

  /** Suites come from an opened workspace folder; without one, an empty state shows. */
  async expectListOrEmptyState(): Promise<void> {
    await expect(this.main.getByRole("table").or(this.main.locator(".panel").first()).or(this.emptyState).first()).toBeVisible();
  }
}
