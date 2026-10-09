import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { api, SINK } from "../support/api";

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

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const ROOT = join(HERE, "..", "..");
/** The viewport, and the video's frame: the same, so nothing is scaled. */
const SIZE = { width: 1600, height: 900 };
const FPS = 30;

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

/** How long the cursor glides to a target before the action lands there. */
const GLIDE = 550;

/**
 * The cursor, drawn by the page itself from the real input events Playwright sends: an arrow that
 * glides to each point and a ring where a button goes down. Nothing but the pointer moves it, so it
 * is where the click is.
 */
const CURSOR = (glide: number) => {
  const install = () => {
    if (document.getElementById("demo-cursor")) return;
    const cursor = document.createElement("div");
    cursor.id = "demo-cursor";
    cursor.innerHTML =
      '<svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 2l0 19 5-4.5 3.4 7.3 3.3-1.5-3.3-7.1 6.8-.4z" fill="#0c100d" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(cursor.style, {
      position: "fixed",
      left: "0",
      top: "0",
      zIndex: "2147483647",
      pointerEvents: "none",
      transform: "translate(-100px,-100px)",
      transition: `transform ${glide - 80}ms cubic-bezier(.3,.7,.2,1)`,
      filter: "drop-shadow(0 2px 3px rgba(0,0,0,.3))",
    });
    document.documentElement.appendChild(cursor);
    let down = false;
    addEventListener(
      "mousemove",
      (e) => {
        cursor.style.transition = down ? "transform 40ms linear" : `transform ${glide - 80}ms cubic-bezier(.3,.7,.2,1)`;
        cursor.style.transform = `translate(${e.clientX - 2}px,${e.clientY - 2}px)`;
      },
      true,
    );
    addEventListener(
      "mousedown",
      (e) => {
        down = true;
        const ring = document.createElement("div");
        Object.assign(ring.style, {
          position: "fixed",
          left: `${e.clientX - 18}px`,
          top: `${e.clientY - 18}px`,
          width: "36px",
          height: "36px",
          borderRadius: "50%",
          border: "2.5px solid #1ae973",
          background: "rgba(26,233,115,.18)",
          zIndex: "2147483646",
          pointerEvents: "none",
          transform: "scale(.4)",
          opacity: "1",
          transition: "transform 450ms ease-out, opacity 450ms ease-out",
        });
        document.documentElement.appendChild(ring);
        requestAnimationFrame(() => {
          ring.style.transform = "scale(1.4)";
          ring.style.opacity = "0";
        });
        setTimeout(() => ring.remove(), 600);
      },
      true,
    );
    addEventListener(
      "mouseup",
      () => {
        down = false;
      },
      true,
    );
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
};

/**
 * While a demo records, every click, hover and drag first moves the pointer to its target and waits
 * out the glide, so the cursor arrives before the page answers. Patched on Locator's prototype for
 * the length of `act`, and put back.
 */
async function gliding<T>(page: Page, run: () => Promise<T>): Promise<T> {
  const proto = Object.getPrototypeOf(page.locator("body")) as Locator;
  const { click, dragTo } = proto;
  const arrive = async (target: Locator, position?: { x: number; y: number }) => {
    await target.hover({ position });
    await page.waitForTimeout(GLIDE);
  };
  proto.click = async function (this: Locator, options?: Parameters<Locator["click"]>[0]) {
    await arrive(this, options?.position);
    return click.call(this, options);
  };
  proto.dragTo = async function (this: Locator, target: Locator, options?: Parameters<Locator["dragTo"]>[1]) {
    await arrive(this, options?.sourcePosition);
    return dragTo.call(this, target, options);
  };
  try {
    return await run();
  } finally {
    Object.assign(proto, { click, dragTo });
  }
}

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

/**
 * The frames, each held until the next one arrived, as a constant-rate 1080p H.264 MP4. A screencast
 * only sends a frame when the page changes, so the timing is the frames' own: ffmpeg's concat
 * demuxer takes a duration per file, and `fps` fills the still stretches. The timestamps' unit is
 * not documented, so a gap is read as milliseconds when the median one would otherwise be seconds.
 */
function encode(dir: string, shot: { name: string; at: number }[], out: string) {
  if (shot.length < 2) throw new Error(`the screencast sent ${shot.length} frame(s); nothing to encode`);
  // Frames can arrive out of their timestamps' order, and a negative duration is one the concat demuxer
  // refuses outright: they are put in time order, and a gap never goes below a tenth of a millisecond.
  const ordered = [...shot].sort((a, b) => a.at - b.at);
  const gaps = ordered.slice(1).map((f, i) => f.at - ordered[i].at);
  const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  const unit = median > 1 ? 1000 : 1;
  const lines = ordered.flatMap((f, i) => [
    `file '${f.name}'`,
    `duration ${Math.max((gaps[i] ?? unit / FPS) / unit, 0.0001).toFixed(4)}`,
  ]);
  // The concat demuxer drops the last entry's duration unless the file is named once more.
  lines.push(`file '${ordered[ordered.length - 1].name}'`);
  const list = join(dir, "frames.txt");
  writeFileSync(list, `${lines.join("\n")}\n`);
  ffmpeg(
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-vf",
    `fps=${FPS}`,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "18",
    // A keyframe a second: a page seeking to a step lands at once instead of decoding from the last one.
    "-g",
    String(FPS),
    "-keyint_min",
    String(FPS),
    "-sc_threshold",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    out,
  );
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
