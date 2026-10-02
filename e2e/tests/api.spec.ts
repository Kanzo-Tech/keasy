import { expect, test } from "@playwright/test";

import { api, expectRefusal } from "../support/api";

test("23 what axum refuses before a handler is an ErrorBody through the BFF", async ({ page }) => {
  expectRefusal(await api(page, "POST", "/v1/jobs", undefined, "{"), 400, "request/malformed");
  expectRefusal(await api(page, "GET", "/v1/nothing-here"), 404, "route/not-found");
});

test("26 a burst over the rate is request/rate-limited", async ({ page }) => {
  await page.goto("/settings/preferences");
  const codes = await page.evaluate(async () => {
    const answers = await Promise.all(
      Array.from({ length: 600 }, () => fetch("/api/v1/auth/workspaces").then(async (r) => [r.status, await r.text()] as const)),
    );
    return answers.filter(([status]) => status === 429).map(([, text]) => (JSON.parse(text) as { code: string }).code);
  });
  expect(codes.length, "some of the burst was refused").toBeGreaterThan(0);
  expect(new Set(codes)).toEqual(new Set(["request/rate-limited"]));
});
