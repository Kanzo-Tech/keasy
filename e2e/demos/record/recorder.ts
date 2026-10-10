import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type Page } from "@playwright/test";
import { playwright, type HarnessEnvironment } from "@kanzo-tech/testing";

import { CURSOR, GLIDE, gliding } from "./cursor";
import { encode, ffmpeg } from "./encode";
import { hold, readingTime } from "./pace";

/**
 * A product demo: a Playwright test that records a story, step by step. `make demo` lists them by
 * these titles (`<name>: <description>`) and records one, or all, in light and dark.
 *
 * A demo is declared, as e2e/demos/STORYBOARD.md writes it: `arrange` sets the page up off camera,
 * and each step is a **subtitle**, an **action** and a **check**. The subtitle leads its step: it is up
 * before the action starts and stays until the next one replaces it. The action is a harness's or a
 * page object's, in data (a brush over 1985–1989, a lasso in lon/lat), and it resolves on the state it
 * caused. The check asserts what must be true after it, so a take whose page did something else fails
 * rather than recording it. `hold` is the only time a demo spends on the clock, and it is the
 * viewer's: the subtitle is left up for its reading time (`readingTime`), counted from when it
 * appeared, so a slow action does not add to it.
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

/** How long a subtitle is up before its step's action starts: it leads, the cursor follows. */
const LEAD = 700;

/** A subtitle: one line, dark, at the foot of the frame, the same on either theme. */
function subtitle(text: string): string {
  const escaped = text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<div style="position:fixed;left:50%;bottom:96px;transform:translateX(-50%);max-width:80%;padding:12px 22px;border-radius:14px;background:rgba(12,16,13,.86);color:#f2fff6;font:600 22px/1.3 Inter,ui-sans-serif,system-ui,sans-serif;letter-spacing:-.01em;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.25);pointer-events:none">${escaped}</div>`;
}
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

/** What `arrange` and the steps act on: the page, and the harness environment over it. */
export interface Stage {
  page: Page;
  env: HarnessEnvironment;
}

/** One step of a demo, as the storyboard's table writes it. */
export interface Step {
  /** What the viewer reads, at most ~60 characters. Up before the action, until the next step's. */
  subtitle: string;
  /** What the step does — a harness or page-object call. None: the step is a reading of the page. */
  action?: () => Promise<unknown>;
  /** What must be true after it; a failure fails the take, and nothing of it is kept. */
  check: () => Promise<void>;
  /** Take the poster after this step's check: `<name>-<theme>.png`, a lossless still. */
  poster?: boolean;
}

export interface Demo<T> {
  /** Before the camera rolls: open the page and set it up; what it returns is handed to `steps`. */
  arrange(stage: Stage): Promise<T>;
  /** The story. A demo has no title card, at the start or the end: only the steps' subtitles. */
  steps(arranged: T, stage: Stage): readonly Step[];
  /** Once every step's check has passed, before the page closes: what a good take keeps (a recording). */
  passed?(arranged: T): Promise<void> | void;
  /** Why the demo cannot be recorded yet, when it cannot: it is listed, and skipped. */
  skip?: string | false;
}

/** `DEMO_THEME=light|dark` records one side; unset, both. The app follows `prefers-color-scheme`
 * while nothing is stored (`KanzoThemeProvider`), so `colorScheme` is the theme switch. */
function themes(): readonly Theme[] {
  const one = process.env.DEMO_THEME;
  if (!one) return THEMES;
  if (!THEMES.includes(one as Theme)) throw new Error(`DEMO_THEME is light or dark, not ${one}`);
  return [one as Theme];
}

export function demo<T>(name: string, description: string, { arrange, steps, passed, skip }: Demo<T>) {
  // eslint-disable-next-line playwright/expect-expect -- the checks are the steps', run in order by `take`
  test(`${name}: ${description}`, async ({ browser, baseURL }) => {
    test.skip(Boolean(skip), skip || undefined);
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
      // Before anything loads: the charts and the canvas register with the hook as they mount. A demo
      // waits on views over whole seeds, so a state is given two minutes to come.
      const stage: Stage = { page, env: await playwright(page, { timeout: 120_000 }) };
      const file = join(OUT, `${name}-${theme}`);
      const frames = `${file}.frames`;
      const chapters: { text: string; start: number; end: number }[] = [];
      try {
        const arranged = await arrange(stage);
        rmSync(frames, { recursive: true, force: true });
        mkdirSync(frames);
        const shot = await take(page, frames, `${file}.png`, steps(arranged, stage), chapters);
        await passed?.(arranged);
        encode(frames, shot, `${file}.mp4`);
        writeFileSync(`${file}.chapters.json`, `${JSON.stringify(chapters, null, 2)}\n`);
      } finally {
        // A failed take leaves nothing behind: its frames are hundreds of JPEGs.
        await context.close();
        rmSync(frames, { recursive: true, force: true });
      }
    }
  });
}

/** Records `steps` on `page`: the frames into `frames`, the poster to `poster`, the subtitles' times into `chapters`. */
async function take(
  page: Page,
  frames: string,
  poster: string,
  steps: readonly Step[],
  chapters: { text: string; start: number; end: number }[],
): Promise<{ name: string; at: number }[]> {
  const shot: { name: string; at: number }[] = [];
  const began = Date.now();
  const now = () => (Date.now() - began) / 1000;
  await page.screencast.start({
    size: SIZE,
    quality: 95,
    onFrame: ({ data, timestamp }) => {
      const frame = `${String(shot.length).padStart(6, "0")}.jpg`;
      writeFileSync(join(frames, frame), data);
      shot.push({ name: frame, at: timestamp });
    },
  });
  let shown: { dispose(): Promise<void> } | undefined;
  await gliding(page, async () => {
    for (const step of steps) {
      // The subtitle leads its step, and stays until the next replaces it.
      await shown?.dispose();
      const up = Date.now();
      const last = chapters.at(-1);
      if (last) last.end = now();
      chapters.push({ text: step.subtitle, start: now(), end: now() });
      shown = await page.screencast.showOverlay(subtitle(step.subtitle));
      await hold(LEAD);
      await step.action?.();
      await step.check();
      if (step.poster) await page.screenshot({ path: poster });
      await hold(readingTime(step.subtitle) - (Date.now() - up));
    }
  });
  await shown?.dispose();
  chapters.at(-1)!.end = now();
  await page.screencast.stop();
  return shot;
}
