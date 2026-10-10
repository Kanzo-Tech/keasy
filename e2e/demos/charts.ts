import type { TileHarness } from "@kanzo-tech/testing";

/**
 * The categories a bar chart's tile draws, top to bottom: its y axis's tick labels, as Observable
 * Plot names their group. `ChartHarness` picks and brushes by value but reads none back, so a step
 * that reads a chart's leaders reads them here.
 */
export async function categories(tile: TileHarness): Promise<string[]> {
  await tile.settled();
  return tile.host.evaluate(
    (card) => [...card.querySelectorAll('g[aria-label="y-axis tick label"] text')].map((label) => label.textContent ?? ""),
    null,
  );
}

/**
 * The categories a bar chart's tile leads with under the page's filter, largest first. Since kanzo-ui
 * 0.38 a chart keeps its axis in the unfiltered order and draws what the filter keeps as a bar over
 * the whole one in grey, so the axis no longer says who leads: the last bar layer, the filtered one,
 * does. Each of its bars is matched to the tick label level with it.
 */
export async function leaders(tile: TileHarness): Promise<string[]> {
  await tile.settled();
  return tile.host.evaluate((card) => {
    const ticks = [...card.querySelectorAll('g[aria-label="y-axis tick label"] text')].map((label) => ({
      name: label.textContent ?? "",
      y: label.getBoundingClientRect().top + label.getBoundingClientRect().height / 2,
    }));
    const layers = card.querySelectorAll('g[aria-label="bar"]');
    const bars = [...(layers[layers.length - 1]?.querySelectorAll("rect") ?? [])].map((rect) => {
      const box = rect.getBoundingClientRect();
      const level = box.top + box.height / 2;
      const tick = ticks.reduce((near, t) => (Math.abs(t.y - level) < Math.abs(near.y - level) ? t : near), ticks[0]!);
      return { name: tick.name, width: box.width };
    });
    return bars.sort((a, b) => b.width - a.width).map((bar) => bar.name);
  }, null);
}
