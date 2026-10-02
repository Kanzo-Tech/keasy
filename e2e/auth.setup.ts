import { mkdirSync } from "node:fs";
import { expect, test as setup } from "@playwright/test";

/**
 * Sign in once per account through the real flow — the app, the BFF, Keycloak's login form — and
 * keep the session cookie for the scenarios. The accounts and their password are the dev realm's
 * (infra/terraform/realm/dev.tfvars), dev literals, never a real credential.
 */
const ACCOUNTS = { member: "dev@keasy.local", owner: "owner@keasy.local" } as const;

for (const [role, email] of Object.entries(ACCOUNTS)) {
  setup(`sign in as the ${role}`, async ({ page }) => {
    mkdirSync(".auth", { recursive: true });
    await page.goto("/");
    await page.locator("#username").fill(email);
    await page.locator("#password").fill(process.env.KEASY_E2E_PASSWORD ?? "password");
    await page.locator("#kc-login").click();
    // The dev realm's password accounts have no name and the User Profile requires one (in
    // production the IdP supplies it), so a fresh realm asks for it on the first sign-in.
    const home = /localhost:3000\/?$/;
    const profile = page.getByRole("heading", { name: "Update Account Information" });
    await Promise.race([page.waitForURL(home, { timeout: 30_000 }), profile.waitFor({ timeout: 30_000 })]);
    if (await profile.isVisible()) {
      await page.getByLabel("First name").fill(role);
      await page.getByLabel("Last name").fill("e2e");
      await page.getByRole("button", { name: "Submit" }).click();
    }
    await expect(page).toHaveURL(home, { timeout: 30_000 });
    await page.context().storageState({ path: `.auth/${role}.json` });
  });
}
