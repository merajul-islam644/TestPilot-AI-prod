import { expect, type Locator, type Page } from "@playwright/test";
import { BasePage } from "./BasePage";

export type SettingsSection = "General" | "Workspace" | "Profile" | "Security" | "Notifications" | "Appearance";

export class SettingsPage extends BasePage {
  readonly railNav: Locator;

  constructor(page: Page) {
    super(page, "/settings", "Settings");
    this.railNav = page.getByRole("navigation", { name: "Settings" });
  }

  /** Rail buttons carry a description after the label — match by prefix. */
  railSection(name: SettingsSection): Locator {
    return this.railNav.getByRole("button", { name: new RegExp(`^${name}`) });
  }

  sectionHeading(name: SettingsSection): Locator {
    return this.page.getByRole("heading", { name, exact: true, level: 3 });
  }

  settingRow(title: string): Locator {
    return this.main.locator(".settings-card-row").filter({ hasText: title });
  }

  workspaceNameInput(): Locator {
    return this.settingRow("Workspace name").getByRole("textbox");
  }

  dangerZoneResetButton(): Locator {
    return this.main.getByRole("button", { name: "Reset demo data" });
  }

  async openSection(name: SettingsSection): Promise<void> {
    await this.railSection(name).click();
    await expect(this.sectionHeading(name)).toBeVisible();
  }
}
