import { expect, test } from "../support/fixtures";

import { api, createGraph, SOURCE } from "../support/stack/api";
import { stop, up, without } from "../support/stack/compose";
import { expectProblem } from "../support/stack/problem";

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
  await without(["acme-server"], async () => {
    for (const path of ["/graphs", "/connections", "/settings/credentials", "/"]) {
      await page.goto(path);
      await expectProblem(page, "api/unreachable", { within: 35_000 });
    }
    const admin = await browser.newContext({ storageState: ".auth/admin.json", baseURL });
    const adminPage = await admin.newPage();
    for (const path of ["/settings/storage"]) {
      await adminPage.goto(path);
      await expectProblem(adminPage, "api/unreachable", { within: 35_000 });
    }
    await admin.close();
  });
  // The server came back with no realm keys cached; its first fetch can miss and start the
  // re-fetch cooldown, refusing with auth/keys-unavailable for a while. The next scenario is not
  // about that, so wait until the API answers again.
  await expect
    .poll(async () => api(page).GET("/v1/connections").then(() => 200, (refused: { status?: number }) => refused.status), {
      timeout: 120_000,
      intervals: [5_000],
    })
    .toBe(200);
});

test("21 a file listing that fails is store/refused, not an empty folder", async ({ page }) => {
  test.setTimeout(300_000);
  await without(["s3"], async () => {
    await page.goto(`/connections/${encodeURIComponent(SOURCE)}`);
    await expectProblem(page, "store/refused", { within: 30_000 });
  });
});
