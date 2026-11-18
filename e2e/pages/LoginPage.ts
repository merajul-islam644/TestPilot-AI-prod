import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The app's own login card (auth screen) plus the hosted Blocks IAM sign-in
 * form it redirects to. The two live on different origins, so every method
 * here also carries its own wait for the hop between them.
 */
export class LoginPage {
  readonly page: Page;

  readonly heading: Locator;
  readonly continueButton: Locator;
  readonly forgotPasswordButton: Locator;
  readonly activationCodeButton: Locator;
  readonly createAccountButton: Locator;

  private readonly iamEmail: Locator;
  private readonly iamPassword: Locator;
  private readonly iamLoginButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole("heading", { name: "Welcome" });
    this.continueButton = page.getByRole("button", { name: "Continue with Blocks" });
    this.forgotPasswordButton = page.getByRole("button", { name: "Forgot password?" });
    this.activationCodeButton = page.getByRole("button", { name: "Have an activation code?" });
    this.createAccountButton = page.getByRole("button", { name: "Create an account" });

    // Hosted IAM (iam.seliseblocks.com) form.
    this.iamEmail = page.getByRole("textbox", { name: "Work Email" });
    this.iamPassword = page.getByRole("textbox", { name: "Password" });
    this.iamLoginButton = page.getByRole("button", { name: "Login" });
  }

  /** Expect the unauthenticated gate. */
  async expectLoginScreen(): Promise<void> {
    await expect(this.heading).toBeVisible();
    await expect(this.continueButton).toBeVisible();
  }

  /** Leave the app for the hosted IAM sign-in form. */
  async continueWithBlocks(): Promise<void> {
    await this.continueButton.click();
    await this.page.waitForURL(/iam\.seliseblocks\.com\/oidc\/login/);
    await expect(this.iamEmail).toBeVisible();
  }

  /** Submit credentials on the hosted form; the caller waits for the redirect back. */
  async signInOnHostedIam(email: string, password: string): Promise<void> {
    await this.iamEmail.fill(email);
    await this.iamPassword.fill(password);
    await this.iamLoginButton.click();
  }
}
