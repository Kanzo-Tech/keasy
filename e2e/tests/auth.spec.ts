import { expect, test } from "../support/fixtures";

import { SOURCE } from "../support/stack/api";
import { restart, stop, up } from "../support/stack/compose";
import { expectProblem } from "../support/stack/problem";

test("08 with Keycloak down a web that cannot fetch the realm's keys lands on /auth/error naming the IdP", async ({ page }) => {
  test.setTimeout(600_000);
  // Signing in is the edge's (oauth2-proxy). What keasy owns is verifying the token the edge
  // forwards, against the realm's keys: a web that has never fetched them, started while Keycloak is
  // down, cannot, and says so by its code rather than by an error page or a sign-in loop.
  // A page first, so the edge holds a token renewed within the last minute: it renews no more until
  // that one lapses, and Keycloak is down from here.
  await page.goto("/");
  await page.getByRole("navigation", { name: "Platform" }).waitFor();
  stop("keycloak");
  try {
    restart("web");
    await page.goto("/");
    await expect(page).toHaveURL(/\/auth\/error\?code=/, { timeout: 60_000 });
    await expectProblem(page, "idp/unreachable", { within: 5_000 });
  } finally {
    up("keycloak");
  }
});

test("10 a session that expired mid-way sends a mutation back to sign in", async ({ page }) => {
  await page.goto(`/connections/${encodeURIComponent(SOURCE)}`);
  await page.getByRole("button", { name: "Test" }).waitFor();
  // The edge answers the API 401 for a request with no session, and the page loads again, which the
  // edge sends to Keycloak's form: its own session went with the cookies.
  await page.context().clearCookies();
  await page.getByRole("button", { name: "Test" }).click();
  await expect(page).toHaveURL(/localhost:8080/, { timeout: 15_000 });
});
