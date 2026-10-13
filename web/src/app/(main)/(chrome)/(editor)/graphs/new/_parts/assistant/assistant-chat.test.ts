// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistantChat, type AssistantChatProps } from "./assistant-chat";
import type { DecisionItem, Question } from "./model";
import { sourceCollection } from "../sources";

// Next's `Link` does not load outside Next (`next/link` resolves only under its bundler); the
// hand-off is an anchor to the same `href` either way.
vi.mock("@kanzo-tech/navigation/next", () => ({
  Link: (props: Record<string, unknown>) => createElement("a", props),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const award: DecisionItem = {
  decision: {
    id: "award-key",
    question: "When two people share a Nobel, do you count one award or two?",
    options: [
      { id: "two", label: "Two, one per person", detail: "Physics 1903 is three awards" },
      { id: "one", label: "One, shared" },
    ],
  },
  assumed: null,
  chosen: null,
};

const country: DecisionItem = {
  decision: {
    id: "country",
    question: "Which country is a laureate's?",
    options: [
      { id: "birth", label: "Where they were born" },
      { id: "affiliation", label: "Where they worked" },
    ],
  },
  assumed: null,
  chosen: null,
};

const share: DecisionItem = {
  decision: {
    id: "share",
    question: "Is “share” a fraction of the prize, or an amount?",
    options: [
      { id: "fraction", label: "A fraction of the prize" },
      { id: "amount", label: "An amount of money" },
    ],
  },
  assumed: "fraction",
  chosen: null,
};

const base: AssistantChatProps = {
  sources: {
    collection: sourceCollection([
      {
        id: "nobel",
        name: "@nobel",
        kind: "connection",
        connection: { name: "nobel", url: "s3://lake/nobel/", kind: "data", direction: "source", secret: "aws" },
        under: "",
        children: [
          { id: "nobel:laureates.csv", name: "laureates.csv", kind: "file", reader: "csv", line: 'laureates := io.csv("@nobel/laureates.csv")', size: 120_000 },
          { id: "nobel:awards.csv", name: "awards.csv", kind: "file", reader: "csv", line: 'awards := io.csv("@nobel/awards.csv")', size: 4_000 },
        ],
      },
    ]),
    loadChildren: async () => [],
    onLoadChildrenComplete: () => {},
    onLoadChildrenError: () => {},
  },
  selected: new Set(),
  reading: null,
  problems: [],
  understanding: {
    things: [{ id: "laureates", name: "Laureates", count: 1018, holds: ["name", "gender", "birth_date"] }],
    relations: [{ id: "r", sentence: "Each award has a laureate, a category and a year.", example: ["Marie Curie", "Physics", "1903"] }],
  },
  offers: [{ id: "q1", text: "Who has won more than one Nobel?" }],
  decisions: null,
  build: null,
  failures: [],
  expanded: ["nobel"],
  onExpandedChange: () => {},
  onSelectedChange: () => {},
  onChoose: () => {},
  questions: [],
  onQuestionsChange: () => {},
  onAdvanced: () => {},
  onBack: () => {},
};

const mounted: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The chat with its questions kept, as the host keeps them. */
function Harness(props: AssistantChatProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  return createElement(AssistantChat, { ...props, questions, onQuestionsChange: setQuestions });
}

function mount(props: Partial<AssistantChatProps>) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const render = (next: Partial<AssistantChatProps>) =>
    act(() => root.render(createElement(Harness, { ...base, ...props, ...next })));
  render({});
  mounted.push(root);
  return { host, render };
}

const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
const replies = (host: HTMLElement) => [...host.querySelectorAll("[data-reply]")].map((r) => r.textContent);

/** Through the files and *what is it about*, to what comes after reading. */
async function through(host: HTMLElement) {
  await act(async () => (button(host, "Read this file") ?? button(host, "Read these files"))!.click());
  await act(async () => button(host, "Skip")!.click());
}

describe("the assistant, as a conversation", () => {
  it("the files' reply is off, and says why, until a file is picked", () => {
    const { host } = mount({});
    const read = button(host, "Read this file") ?? button(host, "Read these files");
    expect(read?.disabled).toBe(true);
    expect(host.querySelector("#pick-status")?.textContent).toBe("Pick at least one file");
  });

  it("the reply shows what was picked, and the files are read under it", async () => {
    const { host, render } = mount({ selected: new Set(["nobel:laureates.csv", "nobel:awards.csv"]) });
    await act(async () => button(host, "Read these files")!.click());
    expect(replies(host)[0]).toContain("These 2 files");
    render({ reading: { done: 1, total: 2 } });
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Reading your files… 1 of 2");
  });

  it("each decision is a turn of its own, counted, and picking an option emits its id", async () => {
    const onChoose = vi.fn();
    const { host } = mount({ selected: new Set(["nobel:laureates.csv"]), decisions: [award, country], onChoose });
    await through(host);
    expect(host.textContent).toContain("two things have no safe answer");
    expect(host.textContent).toContain("Decision 1 of 2");
    expect(host.textContent).not.toContain(country.decision.question);
    const radios = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((r) => r.value)).toEqual(["two", "one"]);
    await act(async () => radios[1].click());
    expect(onChoose).toHaveBeenCalledWith("award-key", "one");
  });

  it("a chosen option is the person's reply, and the next decision follows it", async () => {
    const { host } = mount({
      selected: new Set(["nobel:laureates.csv"]),
      decisions: [{ ...award, chosen: "one" }, country],
    });
    await through(host);
    expect(replies(host)).toContain("One, shared");
    expect(host.textContent).toContain("Decision 2 of 2");
  });

  it("an assumption is said as what was taken, asks nothing, and can be changed", async () => {
    const onChoose = vi.fn();
    const { host } = mount({ selected: new Set(["nobel:laureates.csv"]), decisions: [share], onChoose });
    await through(host);
    const note = host.querySelector('[data-assumption="share"]');
    expect(note?.textContent).toContain("I assumed: A fraction of the prize");
    expect(note?.textContent).toContain(share.decision.question);
    expect(host.querySelector('input[type="radio"]')).toBeNull();
    // It blocks nothing: the questions are already asked.
    expect(host.textContent).toContain("What would you like to know?");
    await act(async () => button(host, "Change")!.click());
    const amount = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => r.value === "amount")!;
    await act(async () => amount.click());
    expect(onChoose).toHaveBeenCalledWith("share", "amount");
  });

  it("a question on offer becomes the person's, with whether it can be answered", async () => {
    const { host } = mount({ selected: new Set(["nobel:laureates.csv"]), decisions: [] });
    await through(host);
    await act(async () => button(host, "Who has won more than one Nobel?")!.click());
    const asked = [...host.querySelectorAll("[data-reply]")].at(-1)!;
    expect(asked.querySelector("[data-question]")?.textContent).toBe("Who has won more than one Nobel?");
    expect(asked.textContent).toContain("Not checked yet");
  });

  it("hands off to Ask once the preview is there, with the person's questions as prompts", async () => {
    const { host } = mount({
      selected: new Set(["nobel:laureates.csv"]),
      decisions: [],
      build: { state: "preview", previewRows: 200, graphId: "g1", percent: 38.2 },
    });
    await through(host);
    await act(async () => button(host, "Who has won more than one Nobel?")!.click());
    await act(async () => button(host, "That's all, build the graph")!.click());
    expect(host.textContent).toContain("The full graph is building (38%)");
    const links = [...host.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual([
      "/graphs/g1/discover?panel=ask",
      `/graphs/g1/discover?panel=ask&q=${encodeURIComponent("Who has won more than one Nobel?")}`,
    ]);
  });

  it("a Task that failed is said where the conversation stopped, with a retry", async () => {
    const retry = vi.fn();
    const { host } = mount({
      selected: new Set(["nobel:laureates.csv"]),
      decisions: [],
      offers: null,
      failures: [{ task: "requirements", problem: new Error("The GPU device was lost"), retry }],
    });
    await through(host);
    expect(host.querySelector('[data-task="requirements"]')?.textContent).toBe("I could not suggest questions for these files.");
    expect(host.querySelector('[data-problem][data-code="llm/failed"]')).not.toBeNull();
    await act(async () => button(host, "Try again")!.click());
    expect(retry).toHaveBeenCalled();
  });

  it("says each change of the person's replies, for the Tasks that wait on them", async () => {
    const onReplies = vi.fn();
    const { host } = mount({ selected: new Set(["nobel:laureates.csv"]), onReplies });
    await through(host);
    expect(onReplies).toHaveBeenLastCalledWith({ picked: true, about: "", asked: false });
  });
});
