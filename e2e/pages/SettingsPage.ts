import { expect, type Locator, type Page } from "@playwright/test";
import { BasePage } from "./BasePage";

export class SettingsPage extends BasePage {
  constructor(page: Page) {
    super(page, "/settings", "Settings");
  }

  /** The stacked layout renders every section head as an h3 on one page. */
  sectionHeading(name: string): Locator {
    return this.page.getByRole("heading", { name, exact: true, level: 3 });
  }
}
