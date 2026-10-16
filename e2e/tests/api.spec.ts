import { expect, test } from "../support/fixtures";

import { raw } from "../support/stack/api";

test("23 what axum refuses before a handler is a problem through the forwarder", async ({ page }) => {
  const type = "application/problem+json";
  expect(await raw(page, "POST", "/v1/graphs", "{")).toEqual({ status: 400, type, code: "request/malformed" });
  expect(await raw(page, "GET", "/v1/nothing-here")).toEqual({ status: 404, type, code: "route/not-found" });
});
