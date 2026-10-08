import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

import { api, SINK } from "../support/api";

/**
 * A product demo: a Playwright test that records instead of asserting. `make demo` lists them by
 * these titles (`<name>: <description>`) and records one, or all, in light and dark.
 *
 * Everything on screen is Playwright's own Screencast API (1.63): `start({ path })` writes the video,
 * `showActions` draws the cursor and each action's title, and `showChapter` the step titles. Its
 * labels, click point and target box cannot be turned off; they are its design, and accepted. What
 * the API lacks is an MP4: it writes VP8 WebM (about 1 Mbit/s at 1080p), so ffmpeg transcodes it to
 * H.264, which every browser plays.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const ROOT = join(HERE, "..", "..");
const SIZE = { width: 1920, height: 1080 };
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

export interface Scene {
  page: Page;
  /** A step title, centred, held for `ms`; the demo waits it out. */
  chapter(title: string, description?: string, ms?: number): Promise<void>;
  /** Take the poster here: `<name>-<theme>.png`, a lossless still of this moment. */
  poster(): Promise<void>;
}

export interface Demo {
  /** Before the camera rolls: open the page and get it to where the demo starts. */
  arrange(page: Page): Promise<void>;
  /** What is recorded. */
  act(scene: Scene): Promise<void>;
}

/** `DEMO_THEME=light|dark` records one side; unset, both. The app follows `prefers-color-scheme`
 * while nothing is stored (`KanzoThemeProvider`), so `colorScheme` is the theme switch. */
function themes(): readonly Theme[] {
  const one = process.env.DEMO_THEME;
  if (!one) return THEMES;
  if (!THEMES.includes(one as Theme)) throw new Error(`DEMO_THEME is light or dark, not ${one}`);
  return [one as Theme];
}

function ffmpeg(...args: string[]) {
  try {
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "inherit"] });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("make demo needs ffmpeg on PATH to write the MP4 (macOS: brew install ffmpeg; Debian/Ubuntu: apt install ffmpeg)");
    }
    throw error;
  }
}

export function demo(name: string, description: string, { arrange, act }: Demo) {
  test(`${name}: ${description}`, async ({ browser, baseURL }) => {
    // A first run builds the dev server's pages and runs the graph; a recording is minutes, not seconds.
    test.setTimeout(20 * 60_000);
    ffmpeg("-version");
    mkdirSync(OUT, { recursive: true });

    for (const theme of themes()) {
      const context = await browser.newContext({
        baseURL,
        storageState: ".auth/editor.json",
        viewport: SIZE,
        deviceScaleFactor: 1,
        colorScheme: theme,
      });
      const page = await context.newPage();
      await arrange(page);

      const file = join(OUT, `${name}-${theme}`);
      await page.screencast.start({ path: `${file}.webm`, size: SIZE });
      await page.screencast.showActions({ cursor: "pointer", duration: 900, position: "top-right", fontSize: 22 });
      await act({
        page,
        chapter: async (title, description, ms = 1600) => {
          await page.screencast.showChapter(title, { description, duration: ms });
          await page.waitForTimeout(ms + 150);
        },
        poster: async () => {
          await page.screenshot({ path: `${file}.png` });
        },
      });
      await page.screencast.stop();
      await context.close();

      ffmpeg("-i", `${file}.webm`, "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", `${file}.mp4`);
      rmSync(`${file}.webm`);
    }
  });
}

/**
 * The completed graph a demo explores, named `Demo · <name>` and run from `infra/dev/<seed>.fossil`
 * over the connections `make dev` declares. Found by name when an earlier run left it, so a second
 * recording does not run it again.
 */
export async function demoGraph(page: Page, name: string, seed: "snb" | "geo"): Promise<string> {
  const title = `Demo · ${name}`;
  const listed = await api(page, "GET", "/v1/graphs");
  const graphs = listed.body as { id: string; name: string | null; status: string }[];
  const done = graphs.find((g) => g.name === title && g.status === "completed");
  if (done) return done.id;

  const script = readFileSync(join(ROOT, "infra", "dev", `${seed}.fossil`), "utf8");
  const created = await api(page, "POST", "/v1/graphs", { script, name: title, sink_connection: SINK, folder: `demo-${seed}-${crypto.randomUUID()}` });
  expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
  const { id } = created.body as { id: string };
  const submitted = await api(page, "POST", `/v1/graphs/${id}/submit`, {});
  expect(submitted.status, JSON.stringify(submitted.body)).toBeLessThan(300);
  await page.goto(`/graphs/${id}`);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("button", { name: "Explore" })).toBeEnabled({ timeout: 10 * 60_000 });
  return id;
}
