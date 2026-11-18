import { expect, type Locator, type Page } from "@playwright/test";
import { BasePage } from "./BasePage";

export class ProjectsPage extends BasePage {
  readonly newProjectButton: Locator;
  readonly projectCard: Locator;
  readonly emptyState: Locator;

  constructor(page: Page) {
    super(page, "/projects", "Projects");
    this.newProjectButton = this.main.getByRole("button", { name: "New project" });
    this.projectCard = this.main.locator(".project-card");
    this.emptyState = this.main.locator(".empty-state");
  }

  /** The workspace may legitimately have zero projects — accept either. */
  async expectListOrEmptyState(): Promise<void> {
    await expect(this.projectCard.or(this.emptyState).first()).toBeVisible();
  }
}
