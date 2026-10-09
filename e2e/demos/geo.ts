import type { Page } from "@playwright/test";

import { switchPanel } from "../support/fixtures";

/**
 * Put `panel` in the dock and wait for it. Pressing the panel the dock already holds closes it
 * (`switchPanel`), and Discover may open with any of them, so it is pressed only when not shown.
 */
export async function showPanel(page: Page, panel: "Info" | "Ask" | "Rules" | "Settings") {
  const shown = page.getByRole("complementary", { name: `${panel} panel` });
  if (!(await shown.isVisible())) await switchPanel(page, panel);
  await shown.waitFor();
}

/** Pick `option` in the Settings panel's select named `label`. */
export async function choose(page: Page, label: string, option: string, title = label) {
  await page.getByRole("combobox", { name: label }).describe(title).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/**
 * The OpenFlights graph placed on a map from the Settings panel: Placement's Map card, then
 * x = `lon` and y = `lat` (the columns the axes offer are `altitude`, `lat` and `lon`). The card
 * draws over its radio, so the card's own label is what is pressed, as a person would.
 */
export async function placeOnMap(page: Page) {
  await showPanel(page, "Settings");
  await page.getByRole("radiogroup", { name: "Placement" }).getByText("Map", { exact: true }).describe("Map").click();
  await choose(page, "X axis", "lon", "longitude across");
  await choose(page, "Y axis", "lat", "latitude up");
}

/** Discover on `id` in the Graph view, its default, once the canvas is up. */
export async function openGraphView(page: Page, id: string) {
  await page.goto(`/graphs/${id}/discover`);
  await page.getByRole("radio", { name: "Graph" }).waitFor({ timeout: 120_000 });
  await page.locator("canvas").first().waitFor({ timeout: 120_000 });
}

/**
 * Discover on the OpenFlights graph `id` as every airport demo starts: in the Graph view, already on a
 * map (x = `lon`, y = `lat`), with its 36.9K routes hidden (drawn, they are fog and nothing on the map
 * reads), and laid out. All of it off camera.
 */
export async function onMap(page: Page, id: string) {
  await openGraphView(page, id);
  // On a map the points come from lon and lat, so the force layout has nothing to do but hold the
  // page up: paused, Settings opens and every click lands at once.
  await pauseLayout(page);
  await placeOnMap(page);
  await hideEdges(page);
  await pauseLayout(page);
  await page.getByRole("button", { name: /^(Resume|Run) the layout$/ }).waitFor({ timeout: 120_000 });
}

/**
 * Legible marks (larger points, so what a filter keeps stands out from what it greys), no routes, and
 * no labels (each an airport's IRI), from the Settings panel, which must be open.
 */
export async function hideEdges(page: Page) {
  await page.getByRole("radiogroup", { name: "Marks" }).getByText("Legible", { exact: true }).click();
  await page.getByRole("radiogroup", { name: "Edges" }).getByText("Hidden", { exact: true }).click();
  const labels = page.getByRole("slider", { name: "Labels" });
  if (await labels.isVisible()) {
    await labels.focus();
    await labels.press("Home");
  }
}

/** Pause the live layout from the graph's toolbar, if it is running. */
export async function pauseLayout(page: Page) {
  const pause = page.getByRole("button", { name: "Pause the layout" });
  if (await pause.isVisible()) await pause.click();
}

/** Widen the dock by `by` pixels from its resize handle, so a panel's columns fit. */
export async function widenDock(page: Page, by: number) {
  // A <button role="separator">, so it is found by its slot rather than as a button.
  const handle = await page.locator('[data-slot="resizable-resize-trigger"]').first().boundingBox();
  if (!handle) return;
  const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - by, y, { steps: 10 });
  await page.mouse.up();
}

/** Zoom the canvas onto what is selected, from the toolbar, when something is. */
export async function frameSelection(page: Page) {
  const frame = page.getByRole("button", { name: "Frame the selection" });
  if (await frame.isVisible()) await frame.click();
}
