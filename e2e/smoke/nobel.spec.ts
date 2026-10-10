import { DiscoverPage } from "../support/app";
import { expect, test } from "../support/smoke";

/**
 * The Nobel laureates dev graph (infra/dev/examples/nobel/mapping.fossil over `make seed`'s
 * derivation): 1,018 laureates, 1,026 awards, 6 categories, 379 institutions and 86 countries. Every
 * number below is the seed's, counted from infra/dev/examples/nobel/data/, which `make seed` pins by
 * digest: 749 awards and 370 institutions have a position, their city's.
 */

test.describe.configure({ timeout: 300_000 });

test("on a map, the Nobel graph places each award at its first affiliation's city, and each institution at its own", async ({ page, env, nobelGraph }) => {
  const discover = await DiscoverPage.open(page, env, nobelGraph);
  const graph = await discover.onMap();
  // 749 + 370 of 2,515 placed; laureates, categories and countries have no position.
  await expect.poll(() => graph.counts()).toMatch(/^1\.1K of 2\.5K nodes placed\b/);
});
