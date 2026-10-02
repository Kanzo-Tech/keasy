import { expect, test } from "@playwright/test";

import { api, expectRefusal } from "../support/api";

test("23 what axum refuses before a handler is an ErrorBody through the BFF", async ({ page }) => {
  expectRefusal(await api(page, "POST", "/v1/jobs", undefined, "{"), 400, "request/malformed");
  expectRefusal(await api(page, "GET", "/v1/nothing-here"), 404, "route/not-found");
});

test("26 a burst over the rate is request/rate-limited", async ({ page }) => {
  // A browser opens six connections to a host, so a burst from a page never outruns the bucket's
  // refill; the request context does not wait its turn, and carries the same session.
  await page.goto("/settings/preferences");
  const answers = await Promise.all(
    Array.from({ length: 1500 }, () => page.request.get("/api/v1/auth/workspaces")),
  );
  const refused = answers.filter((a) => a.status() === 429);
  expect(refused.length, "some of the burst was refused").toBeGreaterThan(0);
  const codes = new Set(await Promise.all(refused.map(async (a) => ((await a.json()) as { code: string }).code)));
  expect(codes).toEqual(new Set(["request/rate-limited"]));
});
