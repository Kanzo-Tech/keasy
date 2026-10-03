import { expect, type Page } from "@playwright/test";

/**
 * Sign in through the real flow — the app, the BFF, Keycloak's form — as one of the platform seed's
 * accounts (kanzo-ui services/auth/seed: dev literals, never a real credential).
 */
export async function signIn(page: Page, username: string) {
  await page.goto("/");
  await enterUsername(page, username);
  await enterPassword(page);
  await expect(page).toHaveURL(/localhost:3000\/?$/, { timeout: 30_000 });
}

/** Keycloak 26's form asks in two steps: the username (or email) first… */
export async function enterUsername(page: Page, username: string) {
  await page.locator("#username").fill(username);
  await page.locator("#kc-login").click();
}

/** …then, on a page of its own, the password. */
export async function enterPassword(page: Page) {
  await page.locator("#password").fill(process.env.KEASY_E2E_PASSWORD ?? "password");
  await page.locator("#kc-login").click();
}
