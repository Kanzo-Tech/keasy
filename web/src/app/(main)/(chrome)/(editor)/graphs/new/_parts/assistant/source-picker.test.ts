// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StorageConnection } from "@/lib/connections";
import { type SourceBranch, type SourceNode, sourceCollection } from "../sources";
import { SourcePicker } from "./source-picker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const connection: StorageConnection = { name: "nobel", url: "s3://lake/nobel/", kind: "data", direction: "source", secret: "aws" };
const file = (path: string, name: string): SourceNode => ({
  id: `nobel:${path}`,
  name,
  kind: "file",
  reader: "csv",
  line: `x := io.csv("@nobel/${path}")`,
  size: 1200,
});
const nobel: SourceBranch = {
  id: "nobel",
  name: "@nobel",
  kind: "connection",
  connection,
  under: "",
  children: [
    {
      id: "nobel/prizes/",
      name: "prizes/",
      kind: "folder",
      connection,
      under: "prizes/",
      children: [file("prizes/awards.csv", "awards.csv"), file("prizes/categories.csv", "categories.csv")],
    },
    { id: "nobel/archive/", name: "archive/", kind: "folder", connection, under: "archive/" },
    file("laureates.csv", "laureates.csv"),
  ],
};
const PRIZES = ["nobel:prizes/awards.csv", "nobel:prizes/categories.csv"];

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
        sources: {
          collection: sourceCollection([nobel]),
          loadChildren: async () => [],
          onLoadChildrenComplete: () => {},
          onLoadChildrenError: () => {},
        },
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
    expect([...onSelectedChange.mock.calls[0][0]].sort()).toEqual(PRIZES);

    const again = mount(new Set(PRIZES));
    await act(async () => again.box("prizes/")!.click());
    expect([...again.onSelectedChange.mock.calls[0][0]]).toEqual([]);
  });

  it("a folder never opened has no box: nobody picks what they have not seen", () => {
    const { box } = mount(new Set());
    expect(box("archive/")).toBeNull();
  });

  it("a folder with some of its files picked is mixed", () => {
    expect(mount(new Set([PRIZES[0]])).box("prizes/")!.getAttribute("aria-checked")).toBe("mixed");
    expect(mount(new Set([...PRIZES, "nobel:laureates.csv"])).box("@nobel")!.getAttribute("aria-checked")).toBe("true");
  });
});
