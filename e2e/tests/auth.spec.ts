import { expect, test } from "@playwright/test";

import { SOURCE } from "../support/api";
import { stop, up } from "../support/compose";
import { expectProblem } from "../support/problem";

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("08 Keycloak down during sign-in lands on /auth/error naming the IdP", async ({ page }) => {
    test.setTimeout(300_000);
    // The BFF caches the IdP's discovery, so with Keycloak already down a sign-in sends the browser
    // straight to a host it cannot reach — the browser's error page, not keasy's to draw. What keasy
    // does own is the callback's token exchange: Keycloak goes down between the form and that.
    await page.route("**/api/auth/callback**", async (route) => {
      stop("keycloak");
      await route.continue();
    });
    try {
      await page.goto("/");
      await page.locator("#username").fill("dev@keasy.local");
      await page.locator("#password").fill(process.env.KEASY_E2E_PASSWORD ?? "password");
      await page.locator("#kc-login").click();
      await expect(page).toHaveURL(/\/auth\/error\?code=/, { timeout: 60_000 });
      await expectProblem(page, "idp/unreachable", { within: 5_000 });
    } finally {
      up("keycloak");
    }
  });

  test("09 a callback whose state does not match is callback/state-mismatch on /auth/error", async ({ page }) => {
    // A callback this browser never started: no transaction cookie, a forged state.
    await page.goto("/api/auth/callback?state=forged&code=forged");
    await expectProblem(page, "callback/state-mismatch", { within: 10_000 });
  });
});

test("10 a session that expired mid-way sends a mutation back to sign in", async ({ page }) => {
  await page.goto(`/connections/${encodeURIComponent(SOURCE)}`);
  await page.getByRole("button", { name: "Test" }).waitFor();
  await page.context().clearCookies();
  await page.getByRole("button", { name: "Test" }).click();
  await expect(page).toHaveURL(/keycloak\.localhost/, { timeout: 15_000 });
});
