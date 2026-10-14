import { defineConfig, devices } from "@playwright/test";

import { BASE_URL } from "./support/stack/api";

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
/**
 * Chromium on the machine's GPU. Headless Chromium draws WebGL in software (SwiftShader) unless told
 * otherwise, and a Graph view of hundreds of thousands of points then lays out at a step a second:
 * minutes for CORDIS's 206K vertices, against seconds on the GPU. These put it on the GPU through
 * ANGLE: Metal on a Mac (measured: "ANGLE Metal Renderer: Apple M4 Pro"); elsewhere the GPU flags
 * still lift the blocklist. A runner with no GPU at all still draws in software.
 */
const GPU = {
  args: [...(process.platform === "darwin" ? ["--use-angle=metal"] : []), "--enable-gpu", "--ignore-gpu-blocklist"],
};

/**
 * The GPU, with WebGPU on: the model runs in the page (`web/src/lib/ai.ts`), and headless Chromium
 * offers WebGPU only when asked — on Linux, over Vulkan. A machine with no GPU still has none, and
 * Ask says so (`llm/unavailable`).
 */
const WEBGPU = {
  args: [...GPU.args, "--enable-unsafe-webgpu", ...(process.platform === "linux" ? ["--enable-features=Vulkan"] : [])],
};

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
    baseURL: BASE_URL,
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
      // The seeds are large graphs, laid out live: on the GPU, as a reader with one sees them.
      use: { storageState: ".auth/editor.json", launchOptions: GPU },
    },
    // The evaluation set (eval/, Kanzo Tasks' phase 1): every case asked of the model the page runs,
    // on this machine's GPU, scored and written to eval/results/<EVAL_MODEL>/. Live, slow, and never
    // part of `test`: it names the projects it runs, as for the demos.
    {
      name: "eval",
      testMatch: /eval\/.*\.eval\.ts$/,
      dependencies: ["setup"],
      use: { storageState: ".auth/editor.json", trace: "off", launchOptions: WEBGPU },
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
        // A demo that asks the model asks the page's, on this machine's GPU.
        launchOptions: WEBGPU,
      },
    },
  ],
});
