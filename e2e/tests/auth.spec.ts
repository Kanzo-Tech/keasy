import { expect, test } from "@playwright/test";

import { SOURCE } from "../support/api";

test.fixme("08 Keycloak down during sign-in lands on a page naming the failure", async () => {
  // waits on kanzo-ui 0.17: the auth callback still answers a JSON body; once it redirects to
  // /auth/error?code=…, this asserts the AuthError's code there.
});

test.fixme("09 a callback whose state does not match is callback.state-mismatch on /auth/error", async () => {
  // waits on kanzo-ui 0.17: the same callback redirect; /auth/error already renders the code.
});

test("10 a session that expired mid-way sends a mutation back to sign in", async ({ page }) => {
  await page.goto(`/connections/${encodeURIComponent(SOURCE)}`);
  await page.getByRole("button", { name: "Test" }).waitFor();
  await page.context().clearCookies();
  await page.getByRole("button", { name: "Test" }).click();
  await expect(page).toHaveURL(/keycloak\.localhost/, { timeout: 15_000 });
});
