import { expect, test } from "../support/fixtures";

import { api, createGraph, SOURCE } from "../support/stack/api";
import { stop, up, without } from "../support/stack/compose";
import { expectProblem } from "../support/stack/problem";
import { signIn } from "../support/auth/sign-in";

test("03 a store that accepts and never answers ends the run as store/silent", async ({ page }) => {
  test.setTimeout(300_000);
  const id = await createGraph(page, { name: "e2e silent store" });
  stop("s3");
  up("s3-silent");
  try {
    await page.goto(`/graphs/${id}`);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    // STS is given 10 s; the run reports the failure it got.
    await expectProblem(page, "store/silent", { within: 40_000 });
  } finally {
    stop("s3-silent");
    up("s3");
  }
});

test("04 a store that refuses to vend ends the run as store/refused", async ({ page }) => {
  test.setTimeout(300_000);
  const id = await createGraph(page, { name: "e2e refused store" });
  await without(["s3"], async () => {
    await page.goto(`/graphs/${id}`);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expectProblem(page, "store/refused", { within: 30_000 });
  });
});

test("05 with the API down every list shows a problem, not an empty state", async ({ page, browser, baseURL }) => {
  test.setTimeout(600_000);
  await without(["server"], async () => {
    for (const path of ["/graphs", "/connections", "/settings/credentials", "/"]) {
      await page.goto(path);
      await expectProblem(page, "bff/failed", { within: 35_000 });
    }
    const admin = await browser.newContext({ storageState: ".auth/admin.json", baseURL });
    const adminPage = await admin.newPage();
    for (const path of ["/settings/storage"]) {
      await adminPage.goto(path);
      await expectProblem(adminPage, "bff/failed", { within: 35_000 });
    }
    await admin.close();
  });
  // The server came back with no realm keys cached; its first fetch can miss and start the
  // re-fetch cooldown, refusing with auth/keys-unavailable for a while. The next scenario is not
  // about that, so wait until the API answers again.
  await expect
    .poll(async () => (await api(page, "GET", "/v1/connections")).status, { timeout: 120_000, intervals: [5_000] })
    .toBe(200);
});

test("07 with Valkey down a page fails in seconds as session/unavailable", async ({ page }) => {
  test.setTimeout(300_000);
  await without(["valkey"], async () => {
    await page.goto("/");
    await expectProblem(page, "session/unavailable", { within: 15_000 });
  });
});

test("21 a file listing that fails is store/refused, not an empty folder", async ({ page }) => {
  test.setTimeout(300_000);
  await without(["s3"], async () => {
    await page.goto(`/connections/${encodeURIComponent(SOURCE)}`);
    await expectProblem(page, "store/refused", { within: 30_000 });
  });
});

test("25 signing out with Keycloak down ends the session and answers, never a stuck button or a 500", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  // A session of its own: signing out ends the session it signs out of, and the shared one is the
  // next scenario's.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, baseURL });
  const page = await context.newPage();
  await signIn(page, "bruno");
  await without(["keycloak"], async () => {
    // What the Log out button navigates to. With the IdP's discovery cached, the BFF sends the
    // browser on to Keycloak's logout — a host the browser cannot reach, whose error page is the
    // browser's, not keasy's to draw. What keasy owns is that sign-out answers at once (a redirect
    // to the IdP, or to /auth/error when it needed the IdP and could not reach it) and that the
    // session is over.
    const answer = await page.request.get("/api/auth/signout?returnTo=/", {
      maxRedirects: 0,
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(answer.status(), await answer.text()).toBe(302);
    const location = answer.headers().location ?? "";
    if (location.includes("/auth/error")) {
      await page.goto(location);
      await expectProblem(page, "idp/unreachable", { within: 5_000 });
    } else {
      // eslint-disable-next-line playwright/no-conditional-expect -- the sign-out lands on either answer, as the BFF reaches the IdP or not; each is checked
      expect(location).toMatch(/localhost:8080/);
    }
    expect((await page.request.get("/api/auth/session")).status()).toBe(401);
  });
  await context.close();
});
