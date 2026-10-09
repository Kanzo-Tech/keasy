import type { Page } from "@playwright/test";
import {
  ComponentHarness,
  DashboardHarness,
  DockHarness,
  FilterBarHarness,
  GraphCanvasHarness,
  type By,
  type HarnessEnvironment,
  type HarnessQuery,
} from "@kanzo-tech/testing";

import { discoverUrl } from "../fixtures";
import { AskPanel } from "./ask";
import { chooseOption } from "./controls";
import { RulesPanel } from "./rules";
import { GraphSearch } from "./search";
import { SettingsPanel } from "./settings";

export type View = "Graph" | "Dashboard";
export type Panel = "Info" | "Ask" | "Rules" | "Settings";

/** `GraphCounts`' sentence — *3.2K nodes · 36.9K edges*, *29 of 3.2K nodes match · …* — the library's own pattern. */
const COUNTS = /\bnodes\b.*\bedges\b/;

/**
 * **Discover** — a graph's page: the view switch (*View*: Graph · Dashboard), the dock and its
 * switcher (*Panels*: Info · Ask · Rules · Settings), the filter bar, and the footer's counts. Its view
 * and panel are in its URL, so `open` deep-links to them rather than clicking towards them.
 *
 * Its host is the document's body: nothing on the page is a landmark holding both the view and the
 * dock. What it hands back are the library's harnesses for the library's parts and keasy's own page
 * objects for its panels.
 */
export class DiscoverPage extends ComponentHarness {
  static readonly by: By = { css: "body" };

  /** Opens the graph's Discover at `view` and `panel` (`"none"` collapses the dock), once its view switch is up. */
  static async open(
    page: Page,
    env: HarnessEnvironment,
    graphId: string,
    at: Parameters<typeof discoverUrl>[1] = {},
  ): Promise<DiscoverPage> {
    await page.goto(discoverUrl(graphId, at));
    const discover = await env.harness(DiscoverPage);
    await discover.views();
    return discover;
  }

  /** The view switch, a single-select toggle group named *View*. */
  views(): Promise<DockHarness> {
    return this.env.harness(DockHarness.with({ name: "View" }));
  }

  /** The dock's switcher, `ShellDockSwitcher`, named *Panels*. */
  dock(): Promise<DockHarness> {
    return this.env.harness(DockHarness.with({ name: "Panels" }));
  }

  /** Switches the main region to `view`, and waits for it to be the checked one. */
  async view(view: View): Promise<void> {
    await (await this.views()).open(view);
  }

  /** Puts `panel` in the dock, if it is not there already, and waits for the panel to be up. */
  async panel(panel: Panel): Promise<void> {
    await (await this.dock()).open(panel);
    await this.env.harness(DiscoverPage.docked(panel));
  }

  /** The canvas of the Graph view. */
  graph(): Promise<GraphCanvasHarness> {
    return this.env.harness(GraphCanvasHarness);
  }

  /** The Dashboard view's dashboard, once it has read its fields and nothing in it is loading. */
  async dashboard(): Promise<DashboardHarness> {
    const dashboard = await this.env.harness(DashboardHarness);
    await dashboard.settled();
    return dashboard;
  }

  /** The page's filter bar. */
  filters(): Promise<FilterBarHarness> {
    return this.env.harness(FilterBarHarness);
  }

  /** The Settings panel, docked. */
  async settings(): Promise<SettingsPanel> {
    await this.panel("Settings");
    return this.env.harness(SettingsPanel);
  }

  /** The Rules panel, docked. */
  async rules(): Promise<RulesPanel> {
    await this.panel("Rules");
    return this.env.harness(RulesPanel);
  }

  /** The Ask panel, docked. */
  async ask(): Promise<AskPanel> {
    await this.panel("Ask");
    return this.env.harness(AskPanel);
  }

  /** The graph search, in the Info panel, docked. */
  async search(): Promise<GraphSearch> {
    await this.panel("Info");
    return this.env.harness(GraphSearch);
  }

  /**
   * Picks the dashboard's relation: its root type in *Root type*, then each hop from *Hop*'s menu by
   * its label, `"replyOfPost → Post"`. The relation is not in the URL, so it is picked, not linked.
   */
  async relation(root: string, hops: readonly string[] = []): Promise<void> {
    const group = await this.env.until(async () => (await this.host.find({ role: "group", name: "Relation" }))[0], "the dashboard has no Relation");
    await chooseOption(this.env, group, "Root type", root);
    for (const hop of hops) {
      const button = await this.env.until(async () => (await group.find({ role: "button", name: "Hop" }))[0], "the relation offers no Hop");
      await button.click();
      const item = await this.env.until(async () => (await this.env.root.find({ role: "menuitem", name: hop }))[0], `Hop offers no ${hop}`);
      await item.click();
      await this.env.until(async () => (await this.env.root.find({ role: "menuitem" })).length === 0, `the Hop menu did not close on ${hop}`);
    }
  }

  /**
   * Widens the dock by `by` pixels from its resize handle, so a panel's columns fit; resolves once
   * the docked panel is wider.
   */
  async widenDock(by: number): Promise<void> {
    const handle = await this.env.until(async () => (await this.host.find({ role: "separator" }))[0], "the dock has no resize handle");
    const panel = await this.env.until(async () => (await this.host.find({ role: "complementary", name: /panel$/ }))[0], "no panel is docked");
    const before = (await panel.rect()).width;
    const { x, y, width, height } = await handle.rect();
    const [cx, cy] = [x + width / 2, y + height / 2];
    await handle.drag([[cx, cy], [cx - by / 2, cy], [cx - by, cy]]);
    await this.env.until(async () => (await panel.rect()).width > before, "the dock did not widen");
  }

  /**
   * OpenFlights as every airport demo starts, in the Graph view: on a map (x = `lon`, y = `lat`), its
   * 36.9K routes hidden (drawn, they are fog and nothing on the map reads), legible marks, no labels
   * (each an airport's IRI), and the layout paused. On a map the points come from lon and lat, so the
   * force layout has nothing to do but hold the page up.
   */
  async onMap(): Promise<GraphCanvasHarness> {
    const graph = await this.graph();
    await graph.ready();
    await graph.pause();
    const settings = await this.settings();
    await settings.placement("Map", { x: "lon", y: "lat" });
    await settings.marks("Legible");
    await settings.edges("Hidden");
    await settings.labels("None");
    await graph.pause();
    return graph;
  }

  /**
   * The footer's `GraphCounts` sentence, once it has counted. It is there in either view, so it is
   * read here rather than through `GraphCanvasHarness.counts()`, which needs the canvas. Not waited
   * on `aria-busy`: GraphCounts is busy until the canvas has drawn, which the Dashboard view never
   * does, while its figures are the corpus's from the first count.
   */
  async counts(): Promise<string> {
    const counts = await this.env.until(async () => (await this.host.find({ text: COUNTS }))[0], "no GraphCounts on the page");
    return counts.text();
  }

  /** A docked panel, by the name the dock gives it: *Rules panel*. */
  static docked(panel: Panel): HarnessQuery<DiscoverPanel> {
    return { type: DiscoverPanel, by: { role: "complementary", name: `${panel} panel` } };
  }
}

/** Any docked panel, for waiting on one to be up. */
class DiscoverPanel extends ComponentHarness {
  static readonly by: By = { role: "complementary", name: /panel$/ };
}
