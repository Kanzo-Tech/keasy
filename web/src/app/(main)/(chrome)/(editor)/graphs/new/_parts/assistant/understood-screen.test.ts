// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { blocks, type DecisionItem } from "./model";
import { UnderstoodScreen, type UnderstoodScreenProps } from "./understood-screen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** No safe default: who the award is counted for has two right answers. */
const open: DecisionItem = {
  decision: {
    id: "award-key",
    question: "When two people share a Nobel, is it one award or two?",
    options: [
      { id: "one", label: "One award", detail: "Counted once, with both laureates" },
      { id: "two", label: "Two awards", detail: "One for each laureate" },
    ],
  },
  assumed: null,
  chosen: null,
};

/** A safe default, taken. */
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

function mount(props: Partial<UnderstoodScreenProps>) {
  const onChoose = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() =>
    root.render(
      createElement(UnderstoodScreen, {
        understanding: {
          things: [{ id: "laureates", name: "Laureates", count: 1018, holds: [] }],
          relations: [
            {
              id: "award",
              sentence: "Each prize has a laureate, a category and a year.",
              example: ["Marie Curie", "Physics", "1903"],
            },
          ],
        },
        decisions: null,
        onChoose,
        questions: [],
        preparing: null,
        ...props,
      }),
    ),
  );
  mounted.push(root);
  return { host, onChoose };
}

describe("What I understood", () => {
  it("says what it found with a count and a real row, never a shape", () => {
    const { host } = mount({});
    expect(host.textContent).toContain("Laureates · 1,018");
    expect(host.textContent).toContain("e.g. Marie Curie · Physics · 1903");
  });

  it("a decision is its options, and picking one emits that option's id", async () => {
    const { host, onChoose } = mount({ decisions: [open] });
    expect(host.textContent).toContain("Counted once, with both laureates");
    const inputs = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(inputs.map((i) => i.value)).toEqual(["one", "two"]);
    await act(async () => inputs[1].click());
    expect(onChoose).toHaveBeenCalledWith("award-key", "two");
  });

  it("an assumption is said, with what was taken, and asks nothing", () => {
    const { host } = mount({ decisions: [assumed] });
    const note = host.querySelector('[data-assumption="country"]');
    expect(note?.textContent).toContain("Where they were born");
    expect(host.querySelector('input[type="radio"]')).toBeNull();
    expect(blocks(assumed)).toBe(false);
    expect(blocks(open)).toBe(true);
    expect(blocks({ ...open, chosen: "one" })).toBe(false);
  });

  it("says whether each question can be answered, and when it has not been checked", () => {
    const { host } = mount({
      questions: [
        { id: "a", text: "Which country has the most laureates?", answerable: true },
        { id: "b", text: "How much was each prize worth?", answerable: false },
        { id: "c", text: "Who won twice?", answerable: null },
      ],
    });
    const rows = [...host.querySelectorAll("li")].map((li) => li.textContent);
    expect(rows).toContain("Which country has the most laureates?These files can answer it");
    expect(rows).toContain("How much was each prize worth?These files cannot answer it");
    expect(rows).toContain("Who won twice?Not checked yet");
  });
});
