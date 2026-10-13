// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { checkState, type SourceTree, toggle } from "./model";
import { SourcePicker } from "./source-picker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tree: SourceTree = {
  roots: [
    {
      id: "nobel",
      name: "@nobel",
      kind: "connection",
      children: [
        {
          id: "nobel/prizes/",
          name: "prizes/",
          kind: "folder",
          children: [
            { id: "nobel:prizes/awards.csv", name: "awards.csv", kind: "file" },
            { id: "nobel:prizes/categories.csv", name: "categories.csv", kind: "file" },
          ],
        },
        { id: "nobel/archive/", name: "archive/", kind: "folder" },
        { id: "nobel:laureates.csv", name: "laureates.csv", kind: "file" },
      ],
    },
  ],
};
const [nobel] = tree.roots;
const prizes = nobel.children![0];
const archive = nobel.children![1];

const mounted: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function mount(selected: ReadonlySet<string>) {
  const onSelectedChange = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() =>
    root.render(
      createElement(SourcePicker, {
        tree,
        selected,
        onSelectedChange,
        expanded: ["nobel", "nobel/prizes/"],
        onExpandedChange: () => {},
      }),
    ),
  );
  mounted.push(root);
  /** The box labelled `Pick <name>`, as the person presses it. */
  const box = (name: string) => host.querySelector<HTMLElement>(`[aria-label="Pick ${name}"]`);
  return { host, box, onSelectedChange };
}

describe("picking files from the tree", () => {
  it("a file's box picks that file", async () => {
    const { box, onSelectedChange } = mount(new Set());
    await act(async () => box("laureates.csv")!.click());
    expect(onSelectedChange).toHaveBeenCalledTimes(1);
    expect([...onSelectedChange.mock.calls[0][0]]).toEqual(["nobel:laureates.csv"]);
  });

  it("a folder's box picks every file listed under it, and a second press drops them", async () => {
    const { box, onSelectedChange } = mount(new Set());
    await act(async () => box("prizes/")!.click());
    expect([...onSelectedChange.mock.calls[0][0]].sort()).toEqual([
      "nobel:prizes/awards.csv",
      "nobel:prizes/categories.csv",
    ]);
    expect(toggle(prizes, new Set(["nobel:prizes/awards.csv", "nobel:prizes/categories.csv"])).size).toBe(0);
  });

  it("a folder never opened has no box: nobody picks what they have not seen", () => {
    const { box } = mount(new Set());
    expect(box("archive/")).toBeNull();
    expect(checkState(archive, new Set())).toBeNull();
  });

  it("a folder with some of its files picked is mixed", () => {
    expect(checkState(prizes, new Set(["nobel:prizes/awards.csv"]))).toBe("indeterminate");
    expect(checkState(nobel, new Set(["nobel:prizes/awards.csv", "nobel:prizes/categories.csv", "nobel:laureates.csv"]))).toBe(true);
  });
});
