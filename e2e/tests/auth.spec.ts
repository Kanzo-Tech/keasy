import { expect, test } from "../support/fixtures";

import { SOURCE } from "../support/api";
import { stop, up } from "../support/compose";
import { expectProblem } from "../support/problem";
import { enterPassword, enterUsername } from "../support/sign-in";

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("08 Keycloak down during sign-in lands on /auth/error naming the IdP", async ({ page }) => {
    test.setTimeout(300_000);
    // The BFF caches the IdP's discovery, so with Keycloak already down a sign-in sends the browser
    // straight to a host it cannot reach — the browser's error page, not keasy's to draw. What keasy
    // does own is the callback's token exchange: Keycloak goes down between the form and that.
    // The callback is a redirect hop, which Playwright does not route; the form's POST is not, so
    // Keycloak answers it, and goes down before the browser follows its redirect to the callback.
    // The form asks in two steps, both posted there; the password's is the one before the callback.
    try {
      await page.goto("/");
      await enterUsername(page, "bruno");
      await page.locator("#password").waitFor();
      await page.route("**/login-actions/authenticate**", async (route) => {
        const answer = await route.fetch({ maxRedirects: 0 });
        stop("keycloak");
        await route.fulfill({ response: answer });
      });
      await enterPassword(page);
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
  await expect(page).toHaveURL(/localhost:8080/, { timeout: 15_000 });
});
