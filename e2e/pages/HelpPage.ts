import { expect, type Locator, type Page } from "@playwright/test";
import { BasePage } from "./BasePage";

export class HelpPage extends BasePage {
  readonly shortcutsTable: Locator;

  constructor(page: Page) {
    super(page, "/help", "Help");
    this.shortcutsTable = this.main.getByRole("table");
  }

  startedStepButton(name: "Projects" | "Test suites" | "Run Tests"): Locator {
    return this.main.getByRole("button", { name, exact: true });
  }

  faqItem(question: string): Locator {
    return this.main.locator("details").filter({ hasText: question });
  }

  async expandFaq(question: string): Promise<void> {
    const details = this.faqItem(question);
    await details.locator("summary").click();
    await expect(details).toHaveAttribute("open", "");
    await expect(details.locator("p")).toBeVisible();
  }
}
