// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SourceBranch, SourceFile, SourceNode } from "../sources";
import { SourceBar } from "./source-bar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const connection = { name: "nobel", url: "s3://lake/nobel/", direction: "source", secret: "aws" } as const;
const file = (path: string, size: number): SourceFile => ({
  id: `nobel:${path}`,
  name: path.split("/").pop()!,
  kind: "file",
  reader: "csv",
  line: `${path} := io.csv("@nobel/${path}")`,
  size,
  vocabulary: false,
});
const prizes: SourceBranch = { id: "nobel/prizes/", name: "prizes/", kind: "folder", connection, under: "prizes/" };
const laureates = file("laureates.csv", 120_000);
const awards = file("awards.csv", 4_000);
const nested = file("prizes/peace.csv", 900);
const shapes: SourceFile = { ...file("shapes.shex", 300), reader: "shex", vocabulary: true };

/** The listing of each branch: the connection's files and one folder, without opening it. */
const list = vi.fn(async (node: SourceBranch): Promise<SourceNode[]> => (node.under === "" ? [prizes, laureates, awards, shapes] : [nested]));

const mounted: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function mount(selected: string[], onPick = vi.fn(), onDrop = vi.fn(), vocabularies: string[] = []) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() =>
    root.render(
      createElement(SourceBar, { connections: [connection], list, selected: new Set(selected), vocabularies: new Set(vocabularies), onPick, onDrop }),
    ),
  );
  mounted.push(root);
  return { host, onPick, onDrop };
}

const settle = () => act(async () => {});
const item = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]')].find((i) => i.textContent?.includes(text))!;

/** The + opened, and the connection opened in it: its files listed. */
async function openNobel() {
  await act(async () => document.querySelector<HTMLElement>('[aria-label="Add files"]')!.click());
  await settle();
  await act(async () => item("nobel").click());
  await settle();
}

describe("the + above the composer, and the file cards", () => {
  it("is one +, and each picked file a card; past three, the rest of a connection is one card", () => {
    expect(mount([]).host.querySelectorAll("[data-file-card]")).toHaveLength(0);
    const ids = ["a.csv", "b.csv", "c.csv", "d.csv", "e.csv"].map((p) => `nobel:${p}`);
    const { host, onDrop } = mount(ids);
    const cards = [...host.querySelectorAll("[data-file-card]")];
    expect(cards.map((c) => c.textContent)).toEqual(["a.csv", "b.csv", "c.csv", "+2 more files · nobel"]);
    act(() => host.querySelector<HTMLElement>('[aria-label="Remove a.csv"]')!.click());
    expect(onDrop).toHaveBeenCalledWith(["nobel:a.csv"]);
    act(() => host.querySelector<HTMLElement>('[aria-label="Remove +2 more files · nobel"]')!.click());
    expect(onDrop).toHaveBeenLastCalledWith(["nobel:d.csv", "nobel:e.csv"]);
  });

  it("lists the connections, then a connection's files, every folder's included, each picked or dropped", async () => {
    const { onPick } = mount(["nobel:awards.csv"]);
    await openNobel();
    const files = [...document.querySelectorAll('[data-slot="command-item"]')].filter((i) => /\.(csv|shex)/.test(i.textContent ?? ""));
    expect(files.map((i) => i.textContent)).toEqual([
      expect.stringContaining("prizes/peace.csv"),
      expect.stringContaining("laureates.csv"),
      expect.stringContaining("awards.csv"),
      expect.stringContaining("shapes.shex"),
    ]);
    expect(files.map((i) => i.hasAttribute("data-picked"))).toEqual([false, false, true, false]);
    // Data picked brings the connection's vocabulary with it.
    await act(async () => item("laureates.csv").click());
    expect(onPick).toHaveBeenCalledWith([laureates, shapes], true);
    await act(async () => item("awards.csv").click());
    expect(onPick).toHaveBeenLastCalledWith([awards], false);
    await act(async () => item("Select all").click());
    expect(onPick).toHaveBeenLastCalledWith([nested, laureates, awards, shapes], true);
  });

  it("draws a connection's vocabulary as a card of its own, which drops it alone", () => {
    const { host, onDrop } = mount(["nobel:laureates.csv", "nobel:shapes.shex"], vi.fn(), vi.fn(), ["nobel:shapes.shex"]);
    const cards = [...host.querySelectorAll("[data-file-card]")];
    expect(cards.map((c) => [c.textContent, c.hasAttribute("data-vocabulary")])).toEqual([
      ["Vocabulary · comes with nobel", true],
      ["laureates.csv", false],
    ]);
    act(() => host.querySelector<HTMLElement>('[aria-label="Remove Vocabulary · comes with nobel"]')!.click());
    expect(onDrop).toHaveBeenCalledWith(["nobel:shapes.shex"]);
  });
});
