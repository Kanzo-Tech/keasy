import { discoverUrl } from "../support/fixtures";
import { seedGraph } from "../support/seeds";
import { demo } from "./record";

/**
 * The worked example: LDBC SNB's Dashboard view — a root type, a bar clicked, a range brushed, and
 * the filters that land in the bar. A new demo is a file like this one beside it: subtitles that say
 * what is happening, and no title card.
 */
demo("snb-explore", "Dashboard over LDBC SNB: pick a type, click a bar, brush a range", {
  async arrange(page) {
    const id = await seedGraph(page, "snb", { name: "Demo · LDBC Social Network", reuse: true });
    // Opened on the dashboard: the Graph view would lay out 327K nodes first, on a machine without a
    // GPU too.
    await page.goto(discoverUrl(id, { view: "dashboard" }));
    await page.getByRole("heading", { name: /Count by Place\.type/ }).waitFor({ timeout: 60_000 });
  },

  async act({ page, chapter, poster }) {
    await chapter("Pick what to explore");
    await page.getByRole("combobox", { name: "Root type" }).describe("the root type").click();
    await page.getByRole("option", { name: "Person" }).describe("Person").click();
    await page.getByRole("heading", { name: /Count by Person\.gender/ }).waitFor();
    await page.waitForTimeout(700);

    await chapter("Every column gets a chart — click a bar to filter");
    const tile = (field: string) =>
      page.locator("article").filter({ has: page.getByRole("heading", { name: `Count by Person.${field}` }) }).getByRole("img");
    const gender = tile("gender");
    const g = await gender.boundingBox();
    // The upper bar of two is `female`.
    await gender.describe("female").click({ position: { x: g!.width * 0.45, y: g!.height * 0.3 } });
    await page.waitForTimeout(1100);

    await chapter("Drag across time to narrow it further");
    const birthday = tile("birthday");
    const b = await birthday.boundingBox();
    await birthday.dragTo(birthday, {
      sourcePosition: { x: b!.width * 0.3, y: b!.height * 0.5 },
      targetPosition: { x: b!.width * 0.62, y: b!.height * 0.5 },
      steps: 20,
    });
    await page.waitForTimeout(1100);
    await poster();

    await chapter("Every filter lands in the bar");
    await page.getByRole("button", { name: /Person\.gender/ }).first().describe("the gender filter").hover();
    await page.waitForTimeout(1000);
  },
});
