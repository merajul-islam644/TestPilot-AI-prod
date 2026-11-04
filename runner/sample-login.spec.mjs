import { expect, test } from "@playwright/test";

// Sample: a REAL Playwright test against the TestPilot app itself.
// The runner will execute this from a temp project with baseURL
// https://dbycry.slsblx.com:5173 (self-signed cert is ignored by config).

test("login page shows the welcome heading", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("Welcome back")).toBeVisible();
});

test("login page offers Blocks sign-in", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /continue with blocks/i })).toBeVisible();
});
