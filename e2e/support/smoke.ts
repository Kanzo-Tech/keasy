import type { Browser, BrowserContext } from "@playwright/test";

import { DiscoverPage } from "./app";
import { signIn } from "./auth/sign-in";
import { expect, test as base } from "./env";
import { type Example, seedGraph } from "./seeds";

/**
 * The smoke suite's fixtures: the dev seed graphs, run once per worker from the programs `make
 * seed`'s data is mapped by (`seedGraph`, support/seeds.ts), and a guard every smoke test runs
 * under: **a console error or an uncaught page error anywhere in the test's browser context fails it.**
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

/**
 * A seed graph, run to completion by the browser on a context of its own — under the same guard, so
 * a run that logs an error fails every test that needs the graph.
 */
async function guardedSeed(browser: Browser, name: string, example: Example, within: number) {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    baseURL: process.env.KEASY_URL ?? "http://acme.localhost:3000",
  });
  const errors = watch(context);
  const page = await context.newPage();
  await signIn(page, "bruno");
  const id = await seedGraph(page, example, { name, within });
  await context.close();
  expect(errors, `console and page errors while running the ${example} example`).toEqual([]);
  return id;
}

export const test = base.extend<{ quiet: void }, { geoGraph: string; snbGraph: string; cordisGraph: string }>({
  // A view over the seeds — a 74K-row join, rudof over 3,218 airports — takes longer than a component.
  harnessTimeout: 60_000,
  quiet: [
    async ({ context }, use) => {
      const errors = watch(context);
      await use();
      expect(errors, "console and page errors").toEqual([]);
    },
    { auto: true },
  ],
  // OpenFlights: 3,218 airports and the 36,906 direct routes between them.
  geoGraph: [async ({ browser }, use) => use(await guardedSeed(browser, "smoke OpenFlights", "openflights", 300_000)), { scope: "worker", timeout: 360_000 }],
  // LDBC SNB SF0.1: 341,661 vertices of nine types.
  snbGraph: [async ({ browser }, use) => use(await guardedSeed(browser, "smoke LDBC SNB", "snb", 900_000)), { scope: "worker", timeout: 960_000 }],
  // CORDIS Horizon Europe: 206,629 vertices of four types — projects, organisations, the
  // participations between them, and funding schemes.
  cordisGraph: [async ({ browser }, use) => use(await guardedSeed(browser, "smoke CORDIS", "cordis", 600_000)), { scope: "worker", timeout: 660_000 }],
});

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
/** A count as a figure reads it: in full under ten thousand, compact above (kanzo-ui's `ChartStat`). */
const figured = (n: number) => (n >= 10_000 ? compact.format(n) : n.toLocaleString("en-US"));

/**
 * What a filter left of the dashboard's relation, once every view agrees on it: the bar's readout
 * (`kept of total noun`), the `count` figure titled `figure` (compact from ten thousand), and the
 * footer's matching nodes — the relation's roots, which are its rows when each root has one path.
 *
 * A harness's brush resolves on the release, and `settled()` once nothing on the dashboard is
 * querying, so what the views read then is the range the drag ended on: they are read until they
 * agree, never held across a second to see that they stay.
 */
export async function agreedCount(discover: DiscoverPage, { total, noun, figure }: { total: number; noun: string; figure: string }) {
  const dashboard = await discover.dashboard();
  const bar = await discover.filters();
  const read = async () => {
    await dashboard.settled();
    const shown = new RegExp(`^([\\d,]+) of ${total.toLocaleString("en-US")} ${noun}$`).exec(await bar.readout())?.[1];
    const counted = (await (await dashboard.tile(figure)).text()).replace(figure, "").trim();
    const matching = (await discover.counts()).split(" of ")[0];
    const kept = Number(shown?.replace(/,/g, "") ?? Number.NaN);
    return shown !== undefined && counted === figured(kept) && matching === compact.format(kept)
      ? kept
      : `readout ${shown}, figure ${counted}, nodes ${matching}`;
  };
  let agreed = Number.NaN;
  await expect
    .poll(async () => {
      const answer = await read();
      if (typeof answer === "number") agreed = answer;
      return answer;
    }, { timeout: 60_000 })
    .toEqual(expect.any(Number));
  return agreed;
}

export { expect };
