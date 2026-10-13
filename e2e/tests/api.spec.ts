import { test } from "../support/fixtures";

import { api, expectRefusal } from "../support/stack/api";

test("23 what axum refuses before a handler is an ErrorBody through the BFF", async ({ page }) => {
  expectRefusal(await api(page, "POST", "/v1/graphs", undefined, "{"), 400, "request/malformed");
  expectRefusal(await api(page, "GET", "/v1/nothing-here"), 404, "route/not-found");
});
