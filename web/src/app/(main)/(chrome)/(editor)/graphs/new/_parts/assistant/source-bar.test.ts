// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SourceBranch, SourceFile, SourceNode } from "../sources";
import { SourceBar } from "./source-bar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const connection = { name: "nobel", url: "s3://lake/nobel/", kind: "data", direction: "source", secret: "aws" } as const;
const file = (path: string, size: number): SourceFile => ({
  id: `nobel:${path}`,
  name: path.split("/").pop()!,
  kind: "file",
  reader: "csv",
  line: `${path} := io.csv("@nobel/${path}")`,
  size,
});
const prizes: SourceBranch = { id: "nobel/prizes/", name: "prizes/", kind: "folder", connection, under: "prizes/" };
const laureates = file("laureates.csv", 120_000);
const awards = file("awards.csv", 4_000);
const nested = file("prizes/peace.csv", 900);

/** The listing of each branch: the connection's files and one folder, without opening it. */
const list = vi.fn(async (node: SourceBranch): Promise<SourceNode[]> => (node.under === "" ? [prizes, laureates, awards] : [nested]));

const mounted: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function mount(selected: string[], onPick = vi.fn(), onClear = vi.fn()) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() => root.render(createElement(SourceBar, { connections: [connection], list, selected: new Set(selected), onPick, onClear })));
  mounted.push(root);
  return { host, onPick, onClear };
}

const open = async () => {
  await act(async () => document.querySelector<HTMLElement>('[data-connection="nobel"] button')!.click());
  await act(async () => {});
};

describe("the pills above the composer", () => {
  it("is a pill per connection, + @name while nothing is picked, and the count with a cross once something is", () => {
    expect(mount([]).host.querySelector("[data-connection]")?.textContent).toBe("@nobel");
    const picked = mount(["nobel:laureates.csv"]);
    expect(picked.host.querySelectorAll("[data-connection]")[0]?.textContent).toContain("@nobel · 1 file");
    expect(picked.host.querySelector('[aria-label="Remove @nobel"]')).not.toBeNull();
  });

  it("opens a menu of what the connection lists: Select all, each file checkable with its size, a submenu for a folder", async () => {
    const { onPick } = mount(["nobel:awards.csv"]);
    await open();
    const items = [...document.querySelectorAll('[role="menuitemcheckbox"]')];
    expect(items.map((i) => i.textContent)).toEqual([expect.stringContaining("laureates.csv"), expect.stringContaining("awards.csv")]);
    expect(items.map((i) => i.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    expect(document.body.textContent).toContain("Select all");
    expect(document.body.textContent).toContain("prizes/");
    // A folder is listed only when its submenu is, not before.
    expect(list.mock.calls.map(([node]) => node.under)).toEqual([""]);
    await act(async () => (items[0] as HTMLElement).click());
    expect(onPick).toHaveBeenCalledWith([laureates], true);
  });
});
