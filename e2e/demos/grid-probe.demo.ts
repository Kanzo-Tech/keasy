import { test } from "@playwright/test";
import { playwright } from "@kanzo-tech/testing";

import { DiscoverPage } from "../support/app";
import { seedGraph } from "../support/seeds";

/**
 * A probe, not a demo: why the Graph view's dot grid shows in a person's browser and not in a
 * recording. It opens OpenFlights on the map as the demos do, at the recording's size, then reports
 * what the page holds — the grid layer and its paint, the canvas's alpha, the device pixel ratio — and
 * how many pixels the grid changes, grid on against grid off, at a scale of 1 and of 2. Delete it once
 * the cause is fixed.
 */
for (const deviceScaleFactor of [1, 2]) {
  test(`grid-probe: the dot grid at a device scale factor of ${deviceScaleFactor}`, async ({ browser, baseURL }) => {
    test.setTimeout(10 * 60_000);
    const context = await browser.newContext({
      baseURL,
      storageState: ".auth/editor.json",
      viewport: { width: 1600, height: 900 },
      deviceScaleFactor,
      colorScheme: "light",
    });
    const page = await context.newPage();
    const env = await playwright(page, { timeout: 120_000 });
    const id = await seedGraph(page, "openflights", { name: "Demo · OpenFlights" });
    const discover = await DiscoverPage.open(page, env, id);
    await discover.onMap();

    const facts = await page.evaluate(() => {
      const host = document.querySelector('[data-slot="graph-canvas"]');
      const grid = host?.firstElementChild as HTMLElement | null;
      const canvas = host?.querySelector("canvas") ?? null;
      const gl = (canvas?.getContext("webgl2") ?? canvas?.getContext("webgl")) as WebGLRenderingContext | null;
      const style = grid ? getComputedStyle(grid) : null;
      const chain: string[] = [];
      for (let el: Element | null = canvas; el && el !== document.body; el = el.parentElement) {
        const bg = getComputedStyle(el).backgroundColor;
        if (bg !== "rgba(0, 0, 0, 0)") chain.push(`${el.tagName.toLowerCase()}[data-slot=${el.getAttribute("data-slot")}] ${bg}`);
      }
      return {
        devicePixelRatio,
        input: getComputedStyle(document.documentElement).getPropertyValue("--input").trim(),
        grid: grid
          ? { image: style!.backgroundImage, size: style!.backgroundSize, position: style!.backgroundPosition, display: style!.display, opacity: style!.opacity }
          : null,
        canvas: canvas ? { attributes: gl?.getContextAttributes() ?? null, css: getComputedStyle(canvas).backgroundColor } : null,
        paintedBehindCanvas: chain,
      };
    });

    // Grid on against grid off, over the same frame: how many pixels the grid changes.
    const settings = await discover.settings();
    const frame = await page.locator('[data-slot="graph-canvas"]').screenshot();
    await settings.backdrop({ vignette: true, grid: false });
    const without = await page.locator('[data-slot="graph-canvas"]').screenshot();
    await settings.backdrop({ vignette: true, grid: true });
    const changed = frame.length === without.length ? frame.reduce((n, byte, i) => n + (byte === without[i] ? 0 : 1), 0) : -1;

    console.log(`grid-probe @${deviceScaleFactor}x`, JSON.stringify({ ...facts, pngBytesChangedByGrid: changed, pngSizes: [frame.length, without.length] }, null, 2));
    await test.info().attach(`grid-on-${deviceScaleFactor}x.png`, { body: frame, contentType: "image/png" });
    await test.info().attach(`grid-off-${deviceScaleFactor}x.png`, { body: without, contentType: "image/png" });
    await context.close();
  });
}
