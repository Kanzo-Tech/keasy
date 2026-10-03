import { expect, test } from "../support/fixtures";

import { api, createJob, expectRefusal, MISSING } from "../support/api";
import { expectProblem } from "../support/problem";

test("06 a 500 on the job is shown as its code, and the poll stops", async ({ page }) => {
  // Running, with no tab running it, so the page polls it; the first read is real, the rest fail.
  const id = await createJob(page);
  await api(page, "POST", `/v1/jobs/${id}/run`);
  let asked = 0;
  await page.route(`**/api/v1/jobs/${id}`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    asked++;
    if (asked === 1) return route.fallback();
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ code: "server/internal", title: "The server failed", detail: "injected", data: {} }),
    });
  });
  await page.goto(`/jobs/${id}`);
  await expectProblem(page, "server/internal", { within: 10_000 });
  const after = asked;
  await page.waitForTimeout(7_000);
  expect(asked, "no poll after the failure").toBe(after);
});

test("18 a run too large for the browser is shown as run/over-budget", async ({ page }) => {
  // A real 2 GB run is not something to put in CI: the job is failed with the problem the runner
  // stores for one, and what is forced is that the stored problem reaches the screen whole.
  const id = await createJob(page);
  await api(page, "POST", `/v1/jobs/${id}/run`);
  const problem = {
    code: "run/over-budget",
    title: "Over budget",
    detail: "the join asked for 3 GB",
    severity: "error",
    data: { budget: 2_147_483_648, consumer: "join", requested: 3_221_225_472, reserved: 0 },
  };
  await api(page, "POST", `/v1/jobs/${id}/status`, { status: "failed", problem });
  await page.goto(`/jobs/${id}`);
  await expectProblem(page, "run/over-budget", { within: 10_000 });
});

test("19 a tab closed mid-run ends the job as job/abandoned, and it can be deleted", async ({ page, context }) => {
  test.setTimeout(240_000);
  const id = await createJob(page, { name: "e2e abandoned" });
  const runner = await context.newPage();
  // The run's reads of the bucket never answer, so it is still running when its tab closes.
  await runner.route(/s3\.localhost/, () => {});
  await runner.goto(`/jobs/${id}`);
  await runner.getByRole("button", { name: "Run", exact: true }).click();
  await expect
    .poll(async () => ((await api(page, "GET", `/v1/jobs/${id}`)).body as { status: string }).status, { timeout: 60_000 })
    .toBe("running");
  await runner.close();

  // Every read sweeps; the lease is 60 s from the last heartbeat.
  await expect
    .poll(async () => ((await api(page, "GET", `/v1/jobs/${id}`)).body as { status: string }).status, {
      timeout: 120_000,
      intervals: [5_000],
    })
    .toBe("failed");
  await page.goto(`/jobs/${id}`);
  await expectProblem(page, "job/abandoned");
  expect((await api(page, "DELETE", `/v1/jobs/${id}`)).status).toBe(204);
});

test("20 deleting a running job is refused as job/still-running", async ({ page }) => {
  // The jobs list offers no Delete for a running job, so the refusal is asked of the API, through
  // the BFF, as the page would ask it.
  const id = await createJob(page);
  await api(page, "POST", `/v1/jobs/${id}/run`);
  expectRefusal(await api(page, "DELETE", `/v1/jobs/${id}`), 409, "job/still-running");
});

test("22 a draft that does not exist opens as job/not-found, and nothing autosaves", async ({ page }) => {
  let saves = 0;
  await page.route(`**/api/v1/jobs/${MISSING}`, (route) => {
    if (route.request().method() === "PATCH") saves++;
    return route.fallback();
  });
  await page.goto(`/jobs/new?draft=${MISSING}`);
  await expectProblem(page, "job/not-found", { within: 10_000 });
  await page.waitForTimeout(3_000);
  expect(saves).toBe(0);
});
