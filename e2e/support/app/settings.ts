import { ComponentHarness, type By } from "@kanzo-tech/testing";

import { chooseOption, chooseRadio } from "./controls";

/** The levels of the Labels setting, fewest first: its slider's steps. */
const LABELS = ["None", "Hovered", "Top", "Visible", "All"] as const;
export type Labels = (typeof LABELS)[number];

/**
 * **The Settings panel** — the graph's section of `@kanzo-tech/graph`'s preferences, as keasy docks
 * it: how the graph draws (Marks, Labels, Edges), where its points come from (Placement, and the
 * X and Y axes a Map reads), and the column the timeline under the graph counts (Timeline).
 */
export class SettingsPanel extends ComponentHarness {
  static readonly by: By = { role: "complementary", name: "Settings panel" };

  /** Places the points by two numeric columns — `{ x: "lon", y: "lat" }` draws a map, north up. */
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
    const slider = await this.one({ role: "slider", name: "Labels" }, "the panel has no Labels");
    const at = async () => (await slider.attribute("aria-valuetext")) === level || (await slider.attribute("aria-valuenow")) === String(LABELS.indexOf(level));
    if (await at()) return;
    await slider.press("Home");
    for (let step = 0; step < LABELS.indexOf(level); step++) await slider.press("ArrowRight");
    await this.env.until(at, `Labels did not change to ${level}`);
  }

  /** The column the timeline under the graph counts, filters by and plays forward; None draws none. */
  timeline(column: string): Promise<void> {
    return chooseOption(this.env, this.host, "Timeline", column);
  }
}
