import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test as base, type BrowserContext, type Page } from "@playwright/test";

import { api } from "./api";
import { runToCompletion } from "./fixtures";
import { signIn } from "./sign-in";

/**
 * The smoke suite's fixtures: the two dev seed graphs, run once per worker from the programs `make
 * seed`'s data is mapped by (infra/dev/snb.fossil, infra/dev/geo.fossil — read from the tree, never
 * retyped), and a guard every smoke test runs under: **a console error or an uncaught page error
 * anywhere in the test's browser context fails it.**
 *
 * Cannot prove: that a page which logs nothing worked — only that it did not say it failed. The
 * specs assert what each view shows, by content, for that.
 */

/**
 * Console errors the guard lets through, each with the reason it is not a failure. Empty: every
 * error a smoke run has logged so far had a cause that was fixed instead. An entry here needs a
 * reason a reviewer can check, and goes the day its cause does.
 */
const BENIGN: readonly { pattern: RegExp; reason: string }[] = [];

/** Every console error and page error `context` reports from now on, as one line each. */
function watch(context: BrowserContext): string[] {
  const seen: string[] = [];
  context.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (BENIGN.some(({ pattern }) => pattern.test(text))) return;
    const { url, lineNumber } = message.location();
    seen.push(`console.error ${text}${url ? ` (${url}:${lineNumber})` : ""}`);
  });
  context.on("weberror", (error) => seen.push(`pageerror ${error.error().stack ?? error.error().message}`));
  return seen;
}

const program = (name: string) => readFileSync(fileURLToPath(new URL(`../../infra/dev/${name}`, import.meta.url)), "utf8");

/**
 * A seed graph, run to completion by the browser on a context of its own — under the same guard, so
 * a run that logs an error fails every test that needs the graph.
 */
async function seedGraph(browser: import("@playwright/test").Browser, name: string, file: string, within: number) {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    baseURL: process.env.KEASY_URL ?? "http://acme.localhost:3000",
  });
  const errors = watch(context);
  const page = await context.newPage();
  await signIn(page, "bruno");
  const id = await runToCompletion(page, { name, script: program(file), within });
  await context.close();
  expect(errors, `console and page errors while running ${file}`).toEqual([]);
  return id;
}

export const test = base.extend<{ quiet: void }, { geoGraph: string; snbGraph: string }>({
  quiet: [
    async ({ context }, use) => {
      const errors = watch(context);
      await use();
      expect(errors, "console and page errors").toEqual([]);
    },
    { auto: true },
  ],
  // OpenFlights: 3,218 airports and the 36,906 direct routes between them.
  geoGraph: [async ({ browser }, use) => use(await seedGraph(browser, "smoke OpenFlights", "geo.fossil", 300_000)), { scope: "worker", timeout: 360_000 }],
  // LDBC SNB SF0.1: 327,588 vertices of eight types.
  snbGraph: [async ({ browser }, use) => use(await seedGraph(browser, "smoke LDBC SNB", "snb.fossil", 900_000)), { scope: "worker", timeout: 960_000 }],
});

/** Save `spec` as the graph's dashboard for the relation keyed `key`, as the Dashboard view's editor does. */
export async function saveDashboard(page: Page, graphId: string, key: string, spec: unknown) {
  const saved = await api(page, "PUT", `/v1/graphs/${graphId}/dashboard`, { spec: { byRelation: { [key]: spec } } });
  expect(saved.status, JSON.stringify(saved.body)).toBeLessThan(300);
}

/** A chart's plot: Observable Plot's root `svg`, not an icon's. */
export const PLOT = 'svg[class^="plot"]';

/**
 * Drag across the middle of a chart tile's plot, from `from` to `to` of its width — a brush on an
 * x interval, or a box on an x×y one.
 */
export async function brush(page: Page, tile: import("@playwright/test").Locator, from = 0.3, to = 0.6) {
  const plot = tile.locator(PLOT).first();
  await plot.scrollIntoViewIfNeeded();
  const box = (await plot.boundingBox())!;
  const y = box.y + box.height * 0.5;
  await page.mouse.move(box.x + box.width * from, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * ((from + to) / 2), y, { steps: 5 });
  await page.mouse.move(box.x + box.width * to, box.y + box.height * 0.8, { steps: 5 });
  await page.mouse.up();
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
/** A count as a figure reads it: in full under ten thousand, compact above (kanzo-ui's `ChartStat`). */
const figured = (n: number) => (n >= 10_000 ? compact.format(n) : n.toLocaleString("en-US"));

/**
 * What a filter left of the dashboard's relation, once every view agrees on it and stays agreed: the
 * bar's readout (`kept of total noun`), the `count` figure titled `figure` (compact from ten
 * thousand), and the footer's matching nodes — the relation's roots, which are its rows when each
 * root has one path. A brush publishes as it is dragged, so views can agree for a moment on a range
 * the drag has already left: this waits for one answer held across two readings a second apart.
 */
export async function agreedCount(page: Page, { total, noun, figure }: { total: number; noun: string; figure: string }) {
  const readout = page.getByRole("region", { name: "Filters" }).getByText(new RegExp(` of ${total.toLocaleString("en-US")} ${noun}$`));
  const stat = page.locator('[data-slot="dashboard-figures"] > *').filter({ hasText: figure });
  const read = async () => {
    const shown = (await readout.textContent({ timeout: 1_000 }).catch(() => null))?.split(" of ")[0];
    const counted = (await stat.textContent())?.replace(figure, "").trim();
    const matching = (await page.locator('[data-slot="graph-counts"]').textContent())?.split(" of ")[0];
    const kept = Number(shown?.replace(/,/g, "") ?? Number.NaN);
    return shown !== undefined && counted === figured(kept) && matching === compact.format(kept)
      ? kept
      : `readout ${shown}, figure ${counted}, nodes ${matching}`;
  };
  let agreed = 0;
  await expect
    .poll(
      async () => {
        const first = await read();
        await page.waitForTimeout(1_000);
        const second = await read();
        if (typeof second === "number" && second === first) agreed = second;
        return second === first ? second : `${first} then ${second}`;
      },
      { timeout: 60_000 },
    )
    .toEqual(expect.any(Number));
  return agreed;
}

export { expect };
