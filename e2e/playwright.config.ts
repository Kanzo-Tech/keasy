import { defineConfig, devices } from "@playwright/test";

/**
 * The end-to-end suite: the compose stack on :3000, one test per scenario of the failure audit, each
 * breaking one thing and asserting the one view that names it (`expectProblem`). Serial, because a
 * scenario that stops a service stops it for everyone.
 *
 * Only on :3000: Keycloak's client admits that origin alone, so a worktree on another port cannot
 * sign in.
 */
export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: process.env.KEASY_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [
    // Needs no stack: every audit scenario has a test by name.
    { name: "guard", testMatch: /coverage\.spec\.ts/ },
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "scenarios",
      testMatch: /tests\/.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { storageState: ".auth/editor.json" },
    },
  ],
});
