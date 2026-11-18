import { type Locator, type Page } from "@playwright/test";
import { BasePage } from "./BasePage";

export type ReportRange = "Last 30 days" | "Last 60 days";

export type ReportSection =
  | "Pass rate"
  | "Executions"
  | "Failures per day"
  | "Success rate by project"
  | "Most frequently failing tests";

export class ReportsPage extends BasePage {
  constructor(page: Page) {
    super(page, "/reports", "Reports");
  }

  rangeRadio(label: ReportRange): Locator {
    return this.main.getByRole("radio", { name: label });
  }

  sectionHeading(name: ReportSection): Locator {
    return this.page.getByRole("heading", { name, exact: true });
  }

  showTableViewButtons(): Locator {
    return this.main.getByRole("button", { name: "Show table view" });
  }
}
