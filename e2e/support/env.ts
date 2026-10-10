import { test as base } from "@playwright/test";
import { playwright, type HarnessEnvironment } from "@kanzo-tech/testing";

/**
 * The fixture every suite builds on: `env`, the `@kanzo-tech/testing` environment over the test's
 * page. Made in a fixture so it is there **before** the test's first navigation: `playwright(page)`
 * installs the test hook with `addInitScript`, and a chart or a graph canvas registers with it while
 * it mounts — a page loaded first would have mounted without it, and a brush or a lasso on it fails
 * with "not registered with the test hook".
 *
 * `harnessTimeout` is how long a harness waits for a state before it fails. The library's 10 s is a
 * component's; a view over the SNB seed's 74K-row join, or rudof over 3,218 airports, takes longer,
 * so the smoke and the demos raise it with `test.use`.
 */
export const test = base.extend<{ env: HarnessEnvironment; harnessTimeout: number }>({
  harnessTimeout: [15_000, { option: true }],
  env: async ({ page, harnessTimeout }, use) => {
    await use(await playwright(page, { timeout: harnessTimeout }));
  },
});

export { expect } from "@playwright/test";
