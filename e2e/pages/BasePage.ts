import { expect, test, type Locator, type Page } from "@playwright/test";
import { testConfig } from "../lib/config";
import { LoginPage } from "./LoginPage";

/**
 * Shared plumbing for every menu page: the app shell's sidebar/topbar handles
 * plus the standard open() helpers. Concrete pages declare their route and
 * their (English) heading, which doubles as the "page has finished loading"
 * signal — the shell renders a skeleton until the gateway load resolves.
 */
export abstract class BasePage {
  readonly page: Page;
  readonly path: string;
  readonly title: string;

  readonly heading: Locator;
  readonly shellNav: Locator;
  readonly main: Locator;

  constructor(page: Page, path: string, title: string) {
    this.page = page;
    this.path = path;
    this.title = title;
    // Scoped to the main h2: when a workspace is empty, the empty state
    // repeats the title as an h3 and a bare name match would hit both.
    this.heading = page.getByRole("main").getByRole("heading", { level: 2, name: title, exact: true });
    this.shellNav = page.getByRole("navigation", { name: "TestPilot" });
    this.main = page.getByRole("main");
  }

  sidebarLink(name: string): Locator {
    return this.shellNav.getByRole("link", { name });
  }

  /**
   * Wait until either the app shell or the login card is on screen. A
   * storageState context re-mints its tokens on first load by silently
   * bouncing through hosted IAM (login → authorize → /login/callback → app),
   * so the shell can take several seconds — and a cold session can land on
   * the login card instead.
   */
  async ensureShell(): Promise<void> {
    const login = new LoginPage(this.page);
    const loginCard = login.continueButton;

    await expect(this.shellNav.or(loginCard).first()).toBeVisible({ timeout: 45_000 });

    if (await loginCard.isVisible().catch(() => false)) {
      await test.step("restore the expired session through hosted login", async () => {
        await login.continueWithBlocks();
        await login.signInOnHostedIam(testConfig.email, testConfig.password);
        await this.page.waitForURL(`${testConfig.baseURL}/**`);
        await this.page.goto(this.path);
        await expect(this.shellNav).toBeVisible({ timeout: 45_000 });
      });
    }
  }

  /** Deep-link straight to the page and wait for its real content. */
  async open(): Promise<void> {
    await this.page.goto(this.path);
    await this.ensureShell();
    await expect(this.heading).toBeVisible({ timeout: 20_000 });
  }

  /**
   * Click through the sidebar like a user would, then wait for content.
   * The shell can reload under our feet (silent token restore, bootstrap
   * re-renders, a failed gateway load), so the click is retried from a
   * fresh load before giving up.
   */
  async openViaSidebar(linkName: string = this.title): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.page.goto("/");
      await this.ensureShell();
      try {
        await this.sidebarLink(linkName).click({ timeout: 10_000 });
        await expect(this.heading).toBeVisible({ timeout: 20_000 });
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}
