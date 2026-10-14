import { ComponentHarness, type By } from "@kanzo-tech/testing";

import { chooseOption, chooseRadio, isChecked } from "./controls";

/** The levels of the Labels setting, fewest first: its slider's steps. */
const LABELS = ["None", "Hovered", "Top", "Visible", "All"] as const;
export type Labels = (typeof LABELS)[number];

/**
 * **The Settings panel** — the graph's section of `@kanzo-tech/graph`'s preferences, as keasy docks
 * it: how the graph draws (Marks, Labels, Edges), where its points come from (Placement, and the
 * X and Y axes a Map reads), the backdrop it sits on (Vignette, Dot grid), and the column the timeline
 * under the graph counts (Timeline).
 */
export class SettingsPanel extends ComponentHarness {
  static readonly by: By = { role: "complementary", name: "Settings panel" };

  /** Places the points by two numeric columns — `{ x: "long", y: "lat" }` draws a map, north up. */
  async placement(placement: "Map", axes: { x: string; y: string }): Promise<void>;
  async placement(placement: "Force" | "Clustered"): Promise<void>;
  async placement(placement: "Force" | "Map" | "Clustered", axes?: { x: string; y: string }): Promise<void> {
    await chooseRadio(this.env, this.host, "Placement", placement);
    if (!axes) return;
    await chooseOption(this.env, this.host, "X axis", axes.x);
    await chooseOption(this.env, this.host, "Y axis", axes.y);
  }

  /** How much ink a point spends: Legible is larger, so what a filter keeps stands out. */
  marks(marks: "Dense" | "Legible"): Promise<void> {
    return chooseRadio(this.env, this.host, "Marks", marks);
  }

  /** Whether links are drawn, and how: past a few thousand they are fog, and Hidden is the answer. */
  edges(edges: "Hidden" | "Straight" | "Curved"): Promise<void> {
    return chooseRadio(this.env, this.host, "Edges", edges);
  }

  /**
   * Which points carry their title. An ordered choice, so a slider: Home is None, and each arrow a
   * level more. Resolves once the slider reads the level.
   */
  async labels(level: Labels): Promise<void> {
    const slider = await this.locatorFor({ role: "slider", name: "Labels" }, "the panel has no Labels")();
    const at = async () => (await slider.getAttribute("aria-valuetext")) === level || (await slider.getAttribute("aria-valuenow")) === String(LABELS.indexOf(level));
    if (await at()) return;
    await slider.sendKeys("Home");
    for (let step = 0; step < LABELS.indexOf(level); step++) await slider.sendKeys("ArrowRight");
    await this.env.until(at, `Labels did not change to ${level}`);
  }

  /**
   * The backdrop the graph sits on: the darkened rim (Vignette) and the dot grid that pans with the
   * camera (Dot grid). Each is kanzo-ui's Switch, a `role="switch"` over Ark's native checkbox: found
   * as a switch, and pressed with Space, as assistive technology does, until it reads `on`.
   */
  async backdrop({ vignette, grid }: { vignette: boolean; grid: boolean }): Promise<void> {
    for (const [name, on] of [["Vignette", vignette], ["Dot grid", grid]] as const) {
      const toggle = await this.locatorFor({ role: "switch", name }, `the panel has no ${name}`)();
      if ((await isChecked(toggle)) !== on) await toggle.sendKeys("Space");
      await this.env.until(async () => (await isChecked(toggle)) === on, `${name} did not turn ${on ? "on" : "off"}`);
    }
  }

  /** The column the timeline under the graph counts, filters by and plays forward; None draws none. */
  timeline(column: string): Promise<void> {
    return chooseOption(this.env, this.host, "Timeline", column);
  }
}
