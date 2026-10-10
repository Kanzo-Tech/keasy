import type { Browser, BrowserContext } from "@playwright/test";

import { DiscoverPage } from "./app";
import { signIn } from "./auth/sign-in";
import { expect, test as base } from "./env";
import { type Example, seedGraph } from "./seeds";

/**
 * The smoke suite's fixtures: the two dev seed graphs, run once per worker from the programs `make
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

export const test = base.extend<{ quiet: void }, { geoGraph: string; snbGraph: string }>({
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
});

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
/** A count as a figure reads it: in full under ten thousand, compact above (kanzo-ui's `ChartStat`). */
export const figured = (n: number) => (n >= 10_000 ? compact.format(n) : n.toLocaleString("en-US"));
/** What a figure reads, as a number: exact under ten thousand, to its last digit above (*28.8K* is 28,800). */
export const counted = (figure: string) => {
  const [, digits, unit] = /^([\d,.]+)([KMB]?)$/.exec(figure) ?? [];
  const scale = { "": 1, K: 1e3, M: 1e6, B: 1e9 }[unit ?? ""] ?? Number.NaN;
  return Math.round(Number(digits?.replace(/,/g, "") ?? Number.NaN) * scale);
};
/** A figure as the footer reads the same count: compact at every size. */
const footed = (figure: string) => compact.format(counted(figure));

/**
 * What a filter left of the dashboard's relation, once every view agrees on it: the `count` figure
 * titled `figure` and the footer's matching nodes — the relation's roots, which are its rows when each
 * root has one path. Returned as the figure reads it, exact under ten thousand (`counted` reads it).
 *
 * A harness's brush resolves on the release, and `settled()` once nothing on the dashboard is
 * querying, so what the views read then is the range the drag ended on: they are read until they
 * agree, never held across a second to see that they stay.
 */
export async function agreedCount(discover: DiscoverPage, { figure }: { figure: string }): Promise<string> {
  const read = async () => {
    const shown = await discover.figure(figure);
    const matching = /^(\S+) of \S+ nodes match/.exec(await discover.counts())?.[1];
    return matching !== undefined && footed(shown) === matching ? { shown } : `figure ${shown}, nodes ${matching}`;
  };
  let agreed = "";
  await expect
    .poll(async () => {
      const answer = await read();
      if (typeof answer === "string") return answer;
      agreed = answer.shown;
      return true;
    }, { timeout: 60_000 })
    .toBe(true);
  return agreed;
}

/**
 * What the dashboard's relation counts with no filter on the page: the `count` figure titled
 * `figure`, or *filtered* while the footer still matches some nodes and not others. Polled for the
 * relation's size: `expect.poll(() => unfiltered(discover, "Airports")).toBe("3,218")`.
 */
export async function unfiltered(discover: DiscoverPage, figure: string): Promise<string> {
  const footer = await discover.counts();
  return footer.includes(" match") ? `filtered: ${footer}` : discover.figure(figure);
}

export { expect };
