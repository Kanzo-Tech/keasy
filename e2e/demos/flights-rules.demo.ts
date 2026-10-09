import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";

import { seedGraph } from "../support/seeds";
import { api } from "../support/stack/api";
import { onMap, showPanel, widenDock } from "./geo";
import { demo } from "./record";

/**
 * Rules over OpenFlights, from the rules already loaded and checked: the findings read, the airports
 * that break a rule lit on the map, then the ones that pass. Off camera, the example's rules
 * (`infra/dev/examples/openflights/rules.ttl`) are saved as the graph's, the graph is placed on a map
 * with its 36.9K routes hidden (with them drawn, nothing on the map reads), and the dock is widened
 * so the findings' columns fit. The Graph view lays out on the GPU: record on a machine with one.
 */
demo("flights-rules", "Rules over OpenFlights on the map: the findings, who fails, then who passes", {
  async arrange(page) {
    const id = await seedGraph(page, "openflights", { name: "Demo · OpenFlights", reuse: true });
    const shapes = readFileSync(fileURLToPath(new URL("../../infra/dev/examples/openflights/rules.ttl", import.meta.url)), "utf8");
    const saved = await api(page, "PUT", `/v1/graphs/${id}/rules`, { name: "geo.ttl", shapes });
    // eslint-disable-next-line playwright/no-standalone-expect -- arrange runs inside demo()'s test
    expect(saved.status, JSON.stringify(saved.body)).toBeLessThan(300);

    await onMap(page, id);
    await widenDock(page, 280);

    await showPanel(page, "Rules");
    await page.getByText(/^Checked over all/).waitFor({ timeout: 120_000 });
    // eslint-disable-next-line playwright/no-wait-for-timeout -- replaced by @kanzo-tech/testing in part 2
    await page.waitForTimeout(500);
  },

  async act({ page, chapter, poster }) {
    await chapter("Every airport, checked against your rules");
    await chapter("Red breaks a rule, amber is a warning");

    const airport = page.getByRole("region", { name: /Airport/ });
    await chapter("Show the ones that break one — the map keeps only them");
    await airport.getByRole("button", { name: /^Show \d+/ }).first().click();
    // eslint-disable-next-line playwright/no-wait-for-timeout -- replaced by @kanzo-tech/testing in part 2
    await page.waitForTimeout(1300);
    await poster();

    await chapter("Or only the airports that pass");
    await airport.getByRole("button", { name: /^Showing \d+/ }).first().click();
    await page.getByRole("button", { name: "Show what conforms" }).click();
    // eslint-disable-next-line playwright/no-wait-for-timeout -- replaced by @kanzo-tech/testing in part 2
    await page.waitForTimeout(1300);
  },
});
