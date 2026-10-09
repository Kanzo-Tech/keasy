import { defineConfig, devices } from "@playwright/test";

/**
 * The end-to-end suite: the compose stack on :3000, one test per scenario of the failure audit, each
 * breaking one thing and asserting the one view that names it (`expectProblem`). Serial, because a
 * scenario that stops a service stops it for everyone.
 *
 * The `smoke` project is the other half: no scenario, the dev seeds driven through every view
 * Discovery has, and any console or page error a failure.
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
    baseURL: process.env.KEASY_URL ?? "http://acme.localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [
    // Needs no stack: every audit scenario has a test by name.
    { name: "guard", testMatch: /coverage\.spec\.ts/ },
    { name: "setup", testMatch: /support\/auth\/auth\.setup\.ts/ },
    {
      name: "scenarios",
      testMatch: /tests\/.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { storageState: ".auth/editor.json" },
    },
    // The dev seeds (`make seed`: LDBC SNB SF0.1, OpenFlights) through every view, where a console
    // or page error fails the test (support/smoke.ts). Needs the seeds in the store.
    {
      name: "smoke",
      testMatch: /\/smoke\/[^/]+\.spec\.ts$/,
      dependencies: ["setup"],
      use: { storageState: ".auth/editor.json" },
    },
    // Product demos, recorded rather than asserted (demos/, `make demo`). Never part of `test`:
    // it names the projects it runs, so CI and `make e2e` do not record.
    {
      name: "demos",
      testMatch: /demos\/.*\.demo\.ts/,
      dependencies: ["setup"],
      // No trace: tracing starts the page's screencast first, at 800px, and a recording joins the
      // screencast already running at its size — the demo comes out 800px wide in a 1080p frame.
      use: {
        storageState: ".auth/editor.json",
        trace: "off",
        // An action waits for its element without bound by default, so a demo whose step never appears
        // hangs instead of failing; 30 s names the step that did not come.
        actionTimeout: 30_000,
        // Headless Chromium draws WebGL in software (SwiftShader) unless told otherwise, and the
        // Graph view of thousands of points then paints at a frame or two a second. These put it on
        // the machine's GPU through ANGLE: Metal on a Mac (measured: "ANGLE Metal Renderer: Apple
        // M4 Pro"); elsewhere the GPU flags still lift the blocklist.
        launchOptions: {
          args: [
            ...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
            "--enable-gpu",
            "--ignore-gpu-blocklist",
          ],
        },
      },
    },
  ],
});
