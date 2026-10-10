import { ComponentHarness, type By, type Handle } from "@kanzo-tech/testing";

import { nameOf } from "./controls";

const OPEN = /Find anything in the graph/;
const PLACEHOLDER = "Find anything in the graph…";
const ADD = /^Add ([\d,]+) to the subset/;

/**
 * **The Info panel's graph search** — `GraphSearch`, *Find anything in the graph*: a button that opens a
 * palette, a `dialog` round a `combobox`. A query such as `country:Spain` typed into it offers *Add N to
 * the subset*, which puts the N vertices it matched on the page as the search's clause and closes it.
 */
export class GraphSearch extends ComponentHarness {
  static readonly by: By = { role: "complementary", name: "Info panel" };

  /**
   * Searches `query` and adds what it matched to the subset; resolves with how many it added. The
   * count follows the typing, so a caller that knows it passes `count`, and the button is pressed only
   * once it offers that many — never the count of a query half typed.
   */
  async add(query: string, count?: number): Promise<number> {
    const box = await this.box();
    await box.fill(query);
    const [button, added] = await this.env.until(async () => {
      const [found] = await this.env.root.find({ role: "button", name: ADD });
      if (!found) return null;
      const offered = Number(ADD.exec(await nameOf(found))?.[1]?.replace(/,/g, ""));
      return count === undefined || offered === count ? ([found, offered] as const) : null;
    }, `the search for ${query} offered ${count ?? "nothing"} to add`);
    await button.click();
    // Adding closes the palette, a dialog round the combobox.
    await this.env.until(async () => !(await this.field()), `the ${added} were not added: the search is still open`);
    return added;
  }

  /** The search's field, opened from its trigger when it is not already open. */
  private async box(): Promise<Handle> {
    if (!(await this.field())) await (await this.one({ role: "button", name: OPEN }, "the Info panel has no graph search")).click();
    return this.env.until(() => this.field(), "the graph search did not open");
  }

  /** The palette's field — Ark's `combobox`, named by its placeholder — while it is open. */
  private async field(): Promise<Handle | undefined> {
    return (await this.env.root.find({ role: "combobox", name: PLACEHOLDER }))[0];
  }
}
