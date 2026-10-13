// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DataScreen, type DataScreenProps } from "./data-screen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function mount(props: Partial<DataScreenProps>) {
  const onQuestionsChange = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() =>
    root.render(
      createElement(DataScreen, {
        tree: { roots: [{ id: "nobel", name: "@nobel", kind: "connection" }] },
        selected: new Set<string>(),
        onSelectedChange: () => {},
        expanded: [],
        onExpandedChange: () => {},
        about: "",
        onAboutChange: () => {},
        assist: null,
        offers: null,
        questions: [],
        onQuestionsChange,
        reading: null,
        problems: [],
        ...props,
      }),
    ),
  );
  mounted.push(root);
  return { host, onQuestionsChange };
}

const status = (host: HTMLElement) => host.querySelector('[role="status"]')?.textContent ?? null;

describe("Your data", () => {
  it("says how far the files have been read", () => {
    const { host } = mount({ reading: { done: 4, total: 6 } });
    expect(status(host)).toBe("Reading the files… 4 of 6");
  });

  it("says nothing of reading when nothing is being read", () => {
    const { host } = mount({ reading: null });
    expect(status(host)).toBeNull();
  });

  it("a question on offer is kept when pressed", async () => {
    const { host, onQuestionsChange } = mount({
      offers: [{ id: "q1", text: "Which country has the most laureates?" }],
    });
    const chip = [...host.querySelectorAll("button")].find((b) => b.textContent === "Which country has the most laureates?");
    await act(async () => chip!.click());
    expect(onQuestionsChange).toHaveBeenCalledWith([
      { id: "q1", text: "Which country has the most laureates?", answerable: null },
    ]);
  });
});
