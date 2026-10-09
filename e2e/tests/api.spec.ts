import { test } from "../support/fixtures";

import { api, expectRefusal } from "../support/stack/api";

test("23 what axum refuses before a handler is an ErrorBody through the BFF", async ({ page }) => {
  expectRefusal(await api(page, "POST", "/v1/graphs", undefined, "{"), 400, "request/malformed");
  expectRefusal(await api(page, "GET", "/v1/nothing-here"), 404, "route/not-found");
});

// eslint-disable-next-line playwright/expect-expect -- a fixme: its comment says what it waits for
test.fixme("26 a burst over the rate is request/rate-limited", async () => {
  // waits on a stack whose BFF serves faster than the limiter refills: the dev BFF answers about a
  // hundred requests a second, which is the dev bucket's refill, so 4000 requests in waves were
  // never refused (first real run, 2026-10-02), and a thousand sockets at once reset the dev
  // server. The refusal's code and shape are forced against the server directly by
  // server/tests/api/failures.rs `a_burst_over_the_rate_is_refused_as_request_rate_limited`.
});
