import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type Page } from "@playwright/test";

import { CURSOR, GLIDE, gliding } from "./cursor";
import { encode, ffmpeg } from "./encode";

/**
 * A product demo: a Playwright test that records instead of asserting. `make demo` lists them by
 * these titles (`<name>: <description>`) and records one, or all, in light and dark.
 *
 * The subtitles are the Screencast API's `showOverlay` (`subtitle`). The cursor is the page's own
 * (`CURSOR`): the API's `showActions` also draws a box round each target and a title for each action,
 * inside a closed shadow root, so neither can be hidden, and the subtitles already say what happens.
 * `showChapter` is not used either: it is a card centred on a blurred page, which hides the very
 * thing the demo shows.
 *
 * The video is not the API's own file. `start({ path })` writes VP8 WebM at about 1 Mbit/s, which
 * blurs a UI's small text. `onFrame` hands over each frame as a high-quality JPEG with its timestamp
 * instead, and ffmpeg encodes them, at their own timing, to H.264.
 *
 * The viewport is 1600×900, not 1920×1080, so the UI's text is larger once the video sits in a page.
 * Frames are capped at the viewport's CSS size (a device scale factor adds nothing to them), and a
 * CSS zoom to get more is wrong: the API draws its cursor and labels in unzoomed coordinates, so
 * they land off the elements they point at.
 */

/** Where a recording lands: e2e/demos/out/, beside the demos. */
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
/** The viewport, and the video's frame: the same, so nothing is scaled. */
const SIZE = { width: 1600, height: 900 };

/**
 * The dev server's furniture, which is not the product: Next's dev indicator (its "N Issues" badge
 * lives in `nextjs-portal`) and React Query's devtools button. Hidden in the page rather than by
 * restarting the web with `NEXT_PUBLIC_KEASY_DEMO`, so a graph demo touches no container.
 */
const FURNITURE = () => {
  const hide = () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal, .tsqd-parent-container { display: none !important; }";
    document.documentElement.appendChild(style);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hide);
  else hide();
};

/** How long a subtitle is read before its step starts. */
const LEAD = 700;

/** A subtitle: one line, dark, at the foot of the frame just above the action titles, the same on
 * either theme. */
function subtitle(text: string): string {
  const escaped = text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<div style="position:fixed;left:50%;bottom:96px;transform:translateX(-50%);max-width:80%;padding:12px 22px;border-radius:14px;background:rgba(12,16,13,.86);color:#f2fff6;font:600 22px/1.3 Inter,ui-sans-serif,system-ui,sans-serif;letter-spacing:-.01em;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.25);pointer-events:none">${escaped}</div>`;
}
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

export interface Scene {
  page: Page;
  /** A subtitle saying what is happening, at the foot of the frame, shown for `ms`; the step starts
   * shortly after it appears. A demo has no title card, at the start or the end: only these. */
  chapter(text: string, ms?: number): Promise<void>;
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
      await context.addInitScript(CURSOR, GLIDE);
      await context.addInitScript(FURNITURE);
      const page = await context.newPage();
      await arrange(page);

      const file = join(OUT, `${name}-${theme}`);
      const frames = `${file}.frames`;
      rmSync(frames, { recursive: true, force: true });
      mkdirSync(frames);
      const shot: { name: string; at: number }[] = [];
      const chapters: { text: string; start: number; end: number }[] = [];
      let shown: { dispose(): Promise<void> } | undefined;
      const began = Date.now();

      await page.screencast.start({
        size: SIZE,
        quality: 95,
        onFrame: ({ data, timestamp }) => {
          const frame = `${String(shot.length).padStart(6, "0")}.jpg`;
          writeFileSync(join(frames, frame), data);
          shot.push({ name: frame, at: timestamp });
        },
      });
      // A failed take leaves nothing behind: its frames are hundreds of JPEGs.
      try {
        await gliding(page, () =>
          act({
            page,
            // A subtitle leads its step rather than holding it up: it shows for `ms`, the step starts
            // after LEAD, and the next subtitle replaces it, so nothing on screen waits on the words.
            chapter: async (text, ms = 2200) => {
              const start = (Date.now() - began) / 1000;
              await shown?.dispose();
              shown = await page.screencast.showOverlay(subtitle(text), { duration: ms });
              await page.waitForTimeout(LEAD);
              chapters.push({ text, start, end: start + ms / 1000 });
            },
            poster: async () => {
              await page.screenshot({ path: `${file}.png` });
            },
          }),
        );
      } catch (error) {
        await context.close();
        rmSync(frames, { recursive: true, force: true });
        throw error;
      }
      await page.screencast.stop();
      await context.close();

      encode(frames, shot, `${file}.mp4`);
      writeFileSync(`${file}.chapters.json`, `${JSON.stringify(chapters, null, 2)}\n`);
      rmSync(frames, { recursive: true });
    }
  });
}
