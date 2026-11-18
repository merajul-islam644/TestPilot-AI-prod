import { type Locator, type Page } from "@playwright/test";
import { BasePage } from "./BasePage";

export class OverviewPage extends BasePage {
  constructor(page: Page) {
    super(page, "/", "Overview");
  }

  rangeRadio(label: "7 days" | "14 days" | "30 days"): Locator {
    return this.page.getByRole("radio", { name: label });
  }

  /** KPI strip only — the same words also appear in the chart legend and table. */
  statLabel(name: "Total tests" | "Passed" | "Failed" | "Success rate"): Locator {
    return this.main.locator(".kpis").getByText(name, { exact: true });
  }

  panelHeading(name: "Test activity" | "Project health" | "Recent test runs"): Locator {
    return this.page.getByRole("heading", { name, exact: true });
  }

  recentRunsTable(): Locator {
    return this.main.getByRole("table");
  }

  recheckFoldersButton(): Locator {
    return this.main.getByRole("button", { name: "Re-check folders" });
  }
}
