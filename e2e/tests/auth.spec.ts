import { expect, test } from "../support/fixtures";

import { SOURCE } from "../support/api";
import { stop, tickets, up, valkey } from "../support/compose";
import { expectProblem } from "../support/problem";
import { enterPassword, enterUsername, signIn } from "../support/sign-in";

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

test.describe("a session that ends while the page is away", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  /**
   * The cookie outlives the session behind it — the realm's idle timeout, a sign-out elsewhere, a
   * store that lost the row. The proxy finds no session behind the cookie and sends the navigation
   * to sign in carrying the page it asked for; Keycloak's own session is still alive, so signing in
   * needs no form and lands back on that page.
   */
  test("a deep link whose session is gone comes back to the same page after signing in", async ({ page }) => {
    const before = tickets();
    await signIn(page, "bruno");
    const mine = [...tickets()].filter((ticket) => !before.has(ticket));
    expect(mine, "one new ticket for this sign-in").toHaveLength(1);

    valkey("DEL", ...mine);

    const deep = `/connections/${encodeURIComponent(SOURCE)}?from=e2e`;
    await page.goto(deep);
    await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === deep, { timeout: 30_000 });
    await page.getByRole("button", { name: "Test" }).waitFor();
  });
});
