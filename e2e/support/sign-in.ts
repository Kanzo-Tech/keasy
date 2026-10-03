import { expect, type Page } from "@playwright/test";

/**
 * Sign in through the real flow — the app, the BFF, Keycloak's form — as one of the platform seed's
 * accounts (kanzo-ui services/auth/seed: dev literals, never a real credential).
 *
 * The dev realm's password accounts have no name and the User Profile requires one (in production
 * the IdP supplies it), so a fresh realm asks for it on the first sign-in.
 */
export async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.locator("#username").fill(email);
  await page.locator("#password").fill(process.env.KEASY_E2E_PASSWORD ?? "password");
  await page.locator("#kc-login").click();
  const home = /localhost:3000\/?$/;
  const profile = page.getByRole("heading", { name: "Update Account Information" });
  await Promise.race([page.waitForURL(home, { timeout: 30_000 }), profile.waitFor({ timeout: 30_000 })]);
  if (await profile.isVisible()) {
    await page.getByLabel("First name").fill(email.split("@")[0] ?? "e2e");
    await page.getByLabel("Last name").fill("e2e");
    await page.getByRole("button", { name: "Submit" }).click();
  }
  await expect(page).toHaveURL(home, { timeout: 30_000 });
}
