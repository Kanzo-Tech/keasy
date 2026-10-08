import { demo, demoGraph } from "./record";

/**
 * The worked example: LDBC SNB's Dashboard view — a root type, a bar clicked, a range brushed, and
 * the filters that land in the bar. A new demo is a file like this one beside it.
 */
demo("snb-explore", "Dashboard over LDBC SNB: pick a type, click a bar, brush a range", {
  async arrange(page) {
    const id = await demoGraph(page, "LDBC Social Network", "snb");
    await page.goto(`/graphs/${id}/discover`);
    // Dispatched rather than clicked: Discovery opens on the Graph view, and while it lays out 327K
    // nodes a pointer click waits for a stable frame that a machine without a GPU never paints.
    await page.getByRole("radio", { name: "Dashboard" }).dispatchEvent("click", undefined, { timeout: 120_000 });
    await page.getByRole("heading", { name: /Count by Place\.type/ }).waitFor({ timeout: 60_000 });
  },

  async act({ page, chapter, poster }) {
    await chapter("LDBC Social Network", "327K nodes · 765K edges, explored in the browser", 2200);

    await chapter("Pick what to explore");
    await page.getByRole("combobox", { name: "Root type" }).describe("the root type").click();
    await page.getByRole("option", { name: "Person" }).describe("Person").click();
    await page.getByRole("heading", { name: /Count by Person\.gender/ }).waitFor();
    await page.waitForTimeout(1200);

    await chapter("Click a bar to filter", "Every column gets a chart");
    const tile = (field: string) =>
      page.locator("article").filter({ has: page.getByRole("heading", { name: `Count by Person.${field}` }) }).getByRole("img");
    const gender = tile("gender");
    const g = await gender.boundingBox();
    // The upper bar of two is `female`.
    await gender.describe("female").click({ position: { x: g!.width * 0.45, y: g!.height * 0.3 } });
    await page.waitForTimeout(1800);

    await chapter("Drag to narrow a range");
    const birthday = tile("birthday");
    const b = await birthday.boundingBox();
    await birthday.dragTo(birthday, {
      sourcePosition: { x: b!.width * 0.3, y: b!.height * 0.5 },
      targetPosition: { x: b!.width * 0.62, y: b!.height * 0.5 },
      steps: 20,
    });
    await page.waitForTimeout(1800);
    await poster();

    await chapter("Every filter lands in the bar");
    await page.getByRole("button", { name: /Person\.gender/ }).first().describe("the gender filter").hover();
    await page.waitForTimeout(1600);
    await chapter("keasy", "Your data, as a graph you can explore", 2000);
  },
});
