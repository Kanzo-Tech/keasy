import { expect, test } from "../support/fixtures";

import { raw } from "../support/stack/api";

test("23 what axum refuses before a handler is an ErrorBody through the BFF", async ({ page }) => {
  expect(await raw(page, "POST", "/v1/graphs", "{")).toEqual({ status: 400, code: "request/malformed" });
  expect(await raw(page, "GET", "/v1/nothing-here")).toEqual({ status: 404, code: "route/not-found" });
});
