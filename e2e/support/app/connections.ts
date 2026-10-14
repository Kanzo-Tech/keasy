import type { Page } from "@playwright/test";
import { ComponentHarness, type By, type Handle, type HarnessEnvironment } from "@kanzo-tech/testing";

/** An action a row's menu offers: whether it may be used, and — when not — why, as the item says. */
export interface Offered {
  enabled: boolean;
  /** The item's words past its label: the reason a disabled one gives. Empty when it is enabled. */
  reason: string;
}

/**
 * **A row's ⋯ menu** — the actions on one object of a table. Every action the caller's role could
 * take is listed; one the object denies them is disabled and says why under its label
 * (`BlockedMenuItem`), so it is read here rather than found missing.
 */
export class RowMenu extends ComponentHarness {
  static readonly by: By = { role: "menu" };

  /** The item that begins with `label`: whether it is enabled, and the reason it gives if not. */
  async offered(label: string): Promise<Offered> {
    const item = await this.item(label);
    const disabled = (await item.attribute("aria-disabled")) === "true" || (await item.attribute("data-disabled")) !== null;
    const words = await item.text();
    return { enabled: !disabled, reason: words.slice(label.length).trim() };
  }

  /** Chooses the item `label`, which must be enabled. */
  async choose(label: string): Promise<void> {
    const { enabled, reason } = await this.offered(label);
    if (!enabled) throw new Error(`${label} is disabled: ${reason}`);
    await (await this.item(label)).click();
  }

  private item(label: string): Promise<Handle> {
    return this.one({ role: "menuitem", name: new RegExp(`^${label}`) }, `the menu offers no ${label}`);
  }
}

/**
 * **Connections** — the page's table of storage connections, data or vocabulary: searched by name,
 * each row with its ⋯ menu (Test, Delete) for an editor, and none for a reader.
 */
export class ConnectionsPage extends ComponentHarness {
  static readonly by: By = { css: "body" };

  /** Opens the tab of `kind`'s connections, once its search is up. */
  static async open(page: Page, env: HarnessEnvironment, kind: "data" | "vocab" = "data"): Promise<ConnectionsPage> {
    await page.goto(`/connections?type=${kind}`);
    const connections = await env.harness(ConnectionsPage);
    await connections.one({ role: "textbox", name: /Search connections/ }, "the connections have no search");
    return connections;
  }

  /** Narrows the table to `name`, and opens that row's menu. */
  async actions(name: string): Promise<RowMenu> {
    const search = await this.one({ role: "textbox", name: /Search connections/ }, "the connections have no search");
    await search.fill(name);
    const trigger = await this.one({ role: "button", name: `Actions for ${name}` }, `${name} has no actions`);
    await trigger.click();
    return this.env.harness(RowMenu);
  }

  /** Whether the row `name` offers a menu at all: a reader's rows offer none. */
  async hasActions(name: string): Promise<boolean> {
    const search = await this.one({ role: "textbox", name: /Search connections/ }, "the connections have no search");
    await search.fill(name);
    await this.one({ role: "cell", name }, `no connection ${name}`);
    return (await this.host.find({ role: "button", name: `Actions for ${name}` })).length > 0;
  }
}
