import { test } from "@playwright/test";

import { createJob, SOURCE } from "../support/api";
import { stop, up, without } from "../support/compose";
import { expectProblem } from "../support/problem";

test("03 a store that accepts and never answers ends the run as store/silent", async ({ page }) => {
  test.setTimeout(300_000);
  const id = await createJob(page, { name: "e2e silent store" });
  stop("minio");
  up("minio-silent");
  try {
    await page.goto(`/jobs/${id}`);
    // STS is given 10 s; the run reports the failure it got.
    await expectProblem(page, "store/silent", { within: 40_000 });
  } finally {
    stop("minio-silent");
    up("minio");
  }
});

test("04 a store that refuses to vend ends the run as store/refused", async ({ page }) => {
  test.setTimeout(300_000);
  const id = await createJob(page, { name: "e2e refused store" });
  await without(["minio"], async () => {
    await page.goto(`/jobs/${id}`);
    await expectProblem(page, "store/refused", { within: 30_000 });
  });
});

test("05 with the API down every list shows a problem, not an empty state", async ({ page, browser, baseURL }) => {
  test.setTimeout(600_000);
  await without(["server"], async () => {
    for (const path of ["/jobs", "/connections", "/settings/credentials", "/"]) {
      await page.goto(path);
      await expectProblem(page, "bff/failed", { within: 35_000 });
    }
    const owner = await browser.newContext({ storageState: ".auth/owner.json", baseURL });
    const ownerPage = await owner.newPage();
    for (const path of ["/datasets", "/catalog"]) {
      await ownerPage.goto(path);
      await expectProblem(ownerPage, "bff/failed", { within: 35_000 });
    }
    await owner.close();
  });
});

test("07 with Valkey down a page fails in seconds as session/store-unavailable", async ({ page }) => {
  test.setTimeout(300_000);
  await without(["valkey"], async () => {
    await page.goto("/");
    await expectProblem(page, "session/store-unavailable", { within: 15_000 });
  });
});

test("21 a file listing that fails is store/list-failed, not an empty folder", async ({ page }) => {
  test.setTimeout(300_000);
  await without(["minio"], async () => {
    await page.goto(`/connections/${encodeURIComponent(SOURCE)}`);
    await expectProblem(page, "store/list-failed", { within: 30_000 });
  });
});

test.fixme("25 signing out with Keycloak down does not leave the button stuck", async () => {
  // waits on kanzo-ui 0.17: sign-out navigates to the BFF's /api/auth/signout, whose failure is a
  // bare Next 500 until its route catches it (audit #17); keasy's own half (the button in
  // try/finally) is in place.
});
