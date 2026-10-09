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
