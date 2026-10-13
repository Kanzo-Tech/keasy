// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExploreScreen, type ExploreScreenProps } from "./explore-screen";
import type { DecisionItem } from "./model";

// Next's `Link` does not load outside Next (`next/link` resolves only under its bundler); the
// hand-off is an anchor to the same `href` either way.
vi.mock("@kanzo-tech/navigation/next", () => ({
  Link: (props: Record<string, unknown>) => createElement("a", props),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const assumed: DecisionItem = {
  decision: {
    id: "country",
    question: "Which country is a laureate's?",
    options: [
      { id: "birth", label: "Where they were born" },
      { id: "affiliation", label: "Where they worked" },
    ],
  },
  assumed: "birth",
  chosen: null,
};

const mounted: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function mount(props: Partial<ExploreScreenProps>) {
  const onChoose = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() => root.render(createElement(ExploreScreen, { build: null, decisions: null, onChoose, ...props })));
  mounted.push(root);
  return { host, onChoose };
}

describe("Explore", () => {
  it("says the answers are over a preview while the whole graph builds, and hands off to Ask", () => {
    const { host } = mount({ build: { state: "preview", previewRows: 200, graphId: "g1", percent: 38 } });
    expect(host.textContent).toContain("Preview over 200 rows · building the full graph · 38 %");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/graphs/g1/discover?panel=ask");
  });

  it("an assumption can be changed here, and the change emits the option's id", async () => {
    const { host, onChoose } = mount({ decisions: [assumed] });
    const change = [...host.querySelectorAll("button")].find((b) => b.textContent === "Change")!;
    await act(async () => change.click());
    const radios = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    await act(async () => radios.find((r) => r.value === "affiliation")!.click());
    expect(onChoose).toHaveBeenCalledWith("country", "affiliation");
  });
});
