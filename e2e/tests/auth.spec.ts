import { expect, test } from "@playwright/test";

import { SOURCE } from "../support/api";
import { without } from "../support/compose";
import { expectProblem } from "../support/problem";

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("08 Keycloak down during sign-in lands on /auth/error naming the IdP", async ({ page }) => {
    test.setTimeout(300_000);
    await without(["keycloak"], async () => {
      await page.goto("/");
      await expect(page).toHaveURL(/\/auth\/error\?code=/, { timeout: 45_000 });
      await expectProblem(page, "idp/unreachable", { within: 5_000 });
    });
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
