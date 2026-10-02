import { expect, test } from "@playwright/test";

import { api, expectRefusal } from "../support/api";

test("23 what axum refuses before a handler is an ErrorBody through the BFF", async ({ page }) => {
  expectRefusal(await api(page, "POST", "/v1/jobs", undefined, "{"), 400, "request/malformed");
  expectRefusal(await api(page, "GET", "/v1/nothing-here"), 404, "route/not-found");
});

test("26 a burst over the rate is request/rate-limited", async ({ page }) => {
  test.setTimeout(180_000);
  // The bucket holds a burst and refills steadily; a page holds six connections and never empties
  // it, and a thousand sockets at once is more than the dev server takes. Waves of a hundred, from
  // the request context with the same session, until the server refuses one.
  await page.goto("/settings/preferences");
  const refused: string[] = [];
  for (let wave = 0; wave < 40 && refused.length === 0; wave++) {
    const answers = await Promise.allSettled(
      Array.from({ length: 100 }, () => page.request.get("/api/v1/auth/workspaces")),
    );
    for (const a of answers) {
      if (a.status === "fulfilled" && a.value.status() === 429) {
        refused.push(((await a.value.json()) as { code: string }).code);
      }
    }
  }
  expect(refused.length, "some of the burst was refused").toBeGreaterThan(0);
  expect(new Set(refused)).toEqual(new Set(["request/rate-limited"]));
});
