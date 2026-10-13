// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type AssistantMessage, toStored } from "@/lib/assistant-conversation";
import { AssistantChat, type AssistantChatProps } from "./assistant-chat";
import type { DecisionItem, Question } from "./model";
import type { Seed } from "./use-assistant";
import { sourceCollection } from "../sources";

// Next's `Link` does not load outside Next (`next/link` resolves only under its bundler); the
// hand-off is an anchor to the same `href` either way.
vi.mock("@kanzo-tech/navigation/next", () => ({
  Link: (props: Record<string, unknown>) => createElement("a", props),
  useRouter: () => ({ push: vi.fn() }),
}));

// What the chat and the flow read from outside, each a double: the page's model, the preview's
// corpus and Ask over it, the preview and the build, the kept conversation, and the hook's Tasks.
const ask = vi.hoisted(() => ({ sendMessage: vi.fn(async () => {}) }));
vi.mock("@/lib/ai", () => ({ usePreloadModel: () => {}, useModelLoad: () => ({ state: "ready" }) }));
vi.mock("@/components/model-status", () => ({ ModelStatus: () => null }));
vi.mock("@/lib/fossil/corpus", () => ({ CorpusScope: ({ children }: { children: unknown }) => children }));
vi.mock("@/lib/fossil/ask", () => ({
  useCorpusAsk: () => ({ chat: { messages: [], status: "ready", sendMessage: ask.sendMessage, error: undefined }, graph: {}, over: {} }),
}));
const doubles = vi.hoisted(() => ({
  usePreview: vi.fn((program: string | null) => ({ state: program === null ? "idle" : "running", corpus: null, rerun: () => {} })),
  build: vi.fn(),
  useBuild: vi.fn(),
  save: vi.fn<(messages: unknown) => Promise<string>>(async () => "c1"),
  stored: [] as unknown[],
  built: false,
  useAssistant: vi.fn(),
}));
vi.mock("@/lib/fossil/preview", () => ({ usePreview: doubles.usePreview }));
vi.mock("../use-build", () => ({ useBuild: doubles.useBuild }));
vi.mock("./use-assistant", () => ({ useAssistant: doubles.useAssistant }));
vi.mock("@/lib/assistant-conversation", async (actual) => ({
  ...(await actual<typeof import("@/lib/assistant-conversation")>()),
  useAssistantConversation: (id: string | null) => ({
    id: id ?? null,
    messages: doubles.stored,
    problem: undefined,
    built: doubles.built,
    save: doubles.save,
    decisions: [],
  }),
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
  files: [],
  program: null,
  preview: { state: "idle", rerun: () => {} },
  onBuild: () => {},
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
    expect(replies(host)[0]).toBe("These 2 files");
    // A reply is what was sent, with nothing under it to undo it.
    expect([...host.querySelectorAll("[data-reply] button")]).toEqual([]);
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

  it("a chosen option is said once, selected in its turn, and the next decision follows it", async () => {
    const onChoose = vi.fn();
    const { host } = mount({
      selected: new Set(["nobel:laureates.csv"]),
      decisions: [{ ...award, chosen: "one" }, country],
      onChoose,
    });
    await through(host);
    expect(replies(host)).not.toContain("One, shared");
    const options = host.querySelector(`[data-decision="award-key"]`)!.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect([...options].find((r) => r.checked)?.value).toBe("one");
    expect(host.textContent).toContain("Decision 2 of 2");
    // Picking the other option in its turn is how it changes.
    await act(async () => [...options].find((r) => r.value === "two")!.click());
    expect(onChoose).toHaveBeenCalledWith("award-key", "two");
  });

  it("an assumption is said as what was taken, with its options, and blocks nothing", async () => {
    const onChoose = vi.fn();
    const { host } = mount({ selected: new Set(["nobel:laureates.csv"]), decisions: [share], onChoose });
    await through(host);
    const note = host.querySelector('[data-assumption="share"]');
    expect(note?.textContent).toContain("I assumed: A fraction of the prize");
    // The question it answers is the turn's, its options in place, the one taken selected — no button to open them.
    expect(host.querySelector('[data-decision="share"] [data-slot="question-prompt"]')?.textContent).toBe(share.decision.question);
    const radios = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.find((r) => r.checked)?.value).toBe("fraction");
    expect(button(host, "Change")).toBeUndefined();
    // It blocks nothing: the questions are already asked.
    expect(host.textContent).toContain("What would you like to know?");
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

  it("says in each turn what is on screen: how to answer only while it can be answered", async () => {
    const { host } = mount({ selected: new Set(["nobel:laureates.csv"]), decisions: [], offers: [] });
    await act(async () => button(host, "Read this file")!.click());
    expect(host.textContent).toContain("A sentence is enough");
    await act(async () => button(host, "Skip")!.click());
    expect(host.textContent).not.toContain("A sentence is enough");
    expect(host.textContent).toContain("Write your questions below");
    await act(async () => button(host, "Skip, show me a preview")!.click());
    // The composer is gone: nothing says to write below it any more.
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.textContent).not.toContain("below");
    expect(host.textContent).toContain("When you are ready, I’ll build the whole graph");
  });

  it("says what the questions under it are once they are asked", async () => {
    const { host } = mount({ selected: new Set(["nobel:laureates.csv"]), decisions: [] });
    await through(host);
    expect(host.textContent).toContain("Take one of these, or write your own below");
    await act(async () => button(host, "Who has won more than one Nobel?")!.click());
    await act(async () => button(host, "That's all, show me a preview")!.click());
    expect(host.textContent).not.toContain("below");
    expect(host.textContent).toContain("Your question, and whether these files can answer it:");
    expect(host.textContent).toContain("When the answers look right, I’ll build the whole graph");
  });

  it("answers each question kept over the preview, in the chat, once the person has asked all", async () => {
    ask.sendMessage.mockClear();
    const { host } = mount({
      selected: new Set(["nobel:laureates.csv"]),
      decisions: [],
      program: "program",
      preview: { state: "ready", corpus: { name: "preview-1" } as never, rerun: () => {} },
    });
    await through(host);
    await act(async () => button(host, "Who has won more than one Nobel?")!.click());
    expect(ask.sendMessage).not.toHaveBeenCalled();
    await act(async () => button(host, "That's all, show me a preview")!.click());
    expect(host.textContent).toContain("Here is your data over its first 200 rows");
    expect(ask.sendMessage).toHaveBeenCalledWith({ text: "Who has won more than one Nobel?" });
  });

  it("says the preview's state: running, and failed with its problem and a retry", async () => {
    const rerun = vi.fn();
    const { host, render } = mount({
      selected: new Set(["nobel:laureates.csv"]),
      decisions: [],
      program: "program",
      preview: { state: "running", corpus: null, rerun },
    });
    await through(host);
    await act(async () => button(host, "Skip, show me a preview")!.click());
    expect(host.textContent).toContain("Running a preview over the first 200 rows of each file");
    render({ preview: { state: "failed", problem: new Error("The run stopped"), corpus: null, rerun } });
    await act(async () => button(host, "Try again")!.click());
    expect(rerun).toHaveBeenCalled();
  });

  it("dims the answers a rerun replaces, under the heading's Updating…, until the new ones land", async () => {
    const corpus = { name: "preview-1" } as never;
    const { host, render } = mount({
      selected: new Set(["nobel:laureates.csv"]),
      decisions: [],
      program: "program",
      preview: { state: "ready", corpus, rerun: () => {} },
    });
    await through(host);
    await act(async () => button(host, "Who has won more than one Nobel?")!.click());
    await act(async () => button(host, "That's all, show me a preview")!.click());
    const answers = () => host.querySelector("[data-preview-answers]")!.parentElement!;
    expect(answers().hasAttribute("data-stale")).toBe(false);
    render({ program: "program", preview: { state: "running", corpus, rerun: () => {} } });
    expect(answers().hasAttribute("data-stale")).toBe(true);
    expect(answers().getAttribute("aria-busy")).toBe("true");
    const heading = host.querySelector('[aria-label="Preview"] p')!;
    expect(heading.textContent).toContain("Here is your data over its first 200 rows");
    expect(heading.querySelector('[role="status"]')?.textContent).toBe("Updating…");
    render({ program: "program", preview: { state: "ready", corpus: { name: "preview-2" } as never, rerun: () => {} } });
    expect(answers().hasAttribute("data-stale")).toBe(false);
    expect(host.textContent).not.toContain("Updating…");
  });

  it("builds the whole graph only on request, from the transcript, and says how far it is", async () => {
    const onBuild = vi.fn();
    const { host, render } = mount({ selected: new Set(["nobel:laureates.csv"]), decisions: [], onBuild });
    await through(host);
    await act(async () => button(host, "Skip, show me a preview")!.click());
    // No program yet: nothing to build.
    expect(button(host, "Build the whole graph")?.disabled).toBe(true);
    render({ program: "program" });
    await act(async () => button(host, "Build the whole graph")!.click());
    expect(onBuild).toHaveBeenCalledTimes(1);
    const kinds = (onBuild.mock.calls[0][0] as AssistantMessage[]).map((m) => m.id);
    expect(kinds.slice(-3)).toEqual(["asked-all", "preview", "build"]);
    render({ program: "program", build: { state: "building", graphId: "g1", percent: 38.2 } });
    expect(host.textContent).toContain("Building your graph… 38%");
  });

  it("once built, hands off to Ask in Discover, with the person's questions as prompts", async () => {
    const { host } = mount({
      selected: new Set(["nobel:laureates.csv"]),
      decisions: [],
      program: "program",
      build: { state: "done", graphId: "g1" },
    });
    await through(host);
    await act(async () => button(host, "Who has won more than one Nobel?")!.click());
    await act(async () => button(host, "That's all, show me a preview")!.click());
    const links = [...host.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual([
      "/graphs/g1/discover?panel=ask",
      `/graphs/g1/discover?panel=ask&q=${encodeURIComponent("Who has won more than one Nobel?")}`,
    ]);
  });

  it("saves, after each reply, only the transcript's structure", async () => {
    const onSave = vi.fn();
    const { host } = mount({
      selected: new Set(["nobel:laureates.csv"]),
      files: [{ connection: "nobel", path: "laureates.csv" }],
      decisions: [share],
      onSave,
    });
    await through(host);
    await act(async () => button(host, "Who has won more than one Nobel?")!.click());
    const saved = onSave.mock.lastCall![0] as AssistantMessage[];
    // Nothing the gate would strip: the chat sends structure only.
    expect(toStored(saved)).toEqual(saved);
    const parts = saved.flatMap((m) => m.parts.map((p) => p.type));
    expect(parts).toEqual(expect.arrayContaining(["data-turn", "data-files", "data-about", "data-decision", "data-question"]));
    const text = JSON.stringify(saved);
    for (const shown of ["1018", "Marie Curie", "Each award has"]) expect(text).not.toContain(shown);
    expect(saved.find((m) => m.id === "asked:q1")?.parts).toContainEqual({
      type: "data-question",
      data: { id: "q1", text: "Who has won more than one Nobel?", answerable: null },
    });
  });

  it("does not save a conversation only read, nor while what follows a reply is not said yet", async () => {
    const onSave = vi.fn();
    mount({ selected: new Set(["nobel:laureates.csv"]), decisions: [], onSave, initial: { picked: true, about: "", asked: true } });
    expect(onSave).not.toHaveBeenCalled();
    const reading = mount({ selected: new Set(["nobel:laureates.csv"]), reading: { done: 0, total: 1 }, onSave });
    await through(reading.host);
    // The files sent is saved; what it is about waits for the files to be read and the model to answer.
    expect(onSave).toHaveBeenCalledTimes(1);
    const ids = () => (onSave.mock.lastCall![0] as AssistantMessage[]).map((m) => m.id);
    expect(ids()).not.toContain("about-reply");
    reading.render({ reading: null });
    expect(onSave).toHaveBeenCalledTimes(1);
    reading.render({ reading: null, decisions: [] });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(ids()).toContain("about-reply");
  });

  it("opens the decision Discover's Change named at its options", async () => {
    const { host } = mount({
      selected: new Set(["nobel:laureates.csv"]),
      decisions: [share],
      initial: { picked: true, about: "", asked: true },
      reopen: "share",
    });
    expect(host.querySelector('[data-assumption="share"]')).not.toBeNull();
    expect([...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((r) => r.value)).toEqual(["fraction", "amount"]);
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

// ── Wired: the flow over the kept conversation, the preview and the build ─────

const { AssistantFlow } = await import("./assistant-flow");
const { converse, messagesOf, NO_REPLIES } = await import("./conversation");

/** The hook as far as the flow reads it: the decision raised, and a program per option standing. */
function useFakeAssistant({ seed, questions }: { seed: Seed; questions: Question[] }) {
  const [chosen, setChosen] = useState<Record<string, string>>({ ...seed.chosen });
  const option = chosen[award.decision.id] ?? null;
  return {
    ...base,
    selected: new Set(seed.files.map((f) => `${f.connection}:${f.path}`)),
    decisions: [{ ...award, chosen: option }],
    questions,
    files: [...seed.files],
    program: "bindings",
    mapped: option === null ? null : `program ${option}`,
    writing: false,
    described: null,
    expanded: [],
    setExpanded: () => {},
    setSelected: () => {},
    choose: (decision: string, picked: string) => setChosen((prev) => ({ ...prev, [decision]: picked })),
  };
}

/** A conversation kept: one file, the award decision taken as *two*, one question, all asked. */
function keptConversation(): AssistantMessage[] {
  const question = { id: "q1", text: "Who has won more than one Nobel?", answerable: true };
  const { turns } = converse(
    { selected: new Set(["nobel:laureates.csv"]), reading: null, decisions: [{ ...award, chosen: "two" }], questions: [question] },
    { ...NO_REPLIES, picked: true, about: "Nobel prizes", asked: true },
  );
  return messagesOf(turns, { files: [{ connection: "nobel", path: "laureates.csv" }], program: "program two" });
}

function mountFlow(props: { conversation?: string; decision?: string } = {}) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() => root.render(createElement(AssistantFlow, { connections: [], formats: [], ...props })));
  mounted.push(root);
  return host;
}

describe("the assistant, wired", () => {
  it("starts a kept conversation where it stood, and previews its program", () => {
    doubles.stored = keptConversation();
    doubles.useAssistant.mockImplementation(useFakeAssistant);
    doubles.useBuild.mockReturnValue({ progress: null, build: doubles.build });
    const host = mountFlow({ conversation: "c1" });
    expect(replies(host)).toEqual([
      expect.stringContaining("This file"),
      "Nobel prizes",
      expect.stringContaining("Who has won more than one Nobel?"),
      "That's all. Show me.",
    ]);
    expect(doubles.useAssistant.mock.lastCall![0]).toMatchObject({
      about: "Nobel prizes",
      asked: true,
      seed: { files: [{ connection: "nobel", path: "laureates.csv" }], chosen: { "award-key": "two" }, program: "program two" },
    });
    expect(doubles.usePreview.mock.lastCall![0]).toBe("program two");
  });

  it("a decision changed is a program changed, and the preview runs it", async () => {
    doubles.stored = keptConversation();
    doubles.useAssistant.mockImplementation(useFakeAssistant);
    doubles.useBuild.mockReturnValue({ progress: null, build: doubles.build });
    doubles.save.mockClear();
    const host = mountFlow({ conversation: "c1", decision: "award-key" });
    const one = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => r.value === "one")!;
    await act(async () => one.click());
    expect(doubles.usePreview.mock.lastCall![0]).toBe("program one");
    // The reply is saved, with the decision's last word the person's.
    const saved = doubles.save.mock.lastCall![0] as AssistantMessage[];
    expect(saved.find((m) => m.id === "decided:award-key")?.parts).toContainEqual(
      expect.objectContaining({ type: "data-decision", data: expect.objectContaining({ option: "one", assumed: false }) }),
    );
  });

  it("builds from the conversation saved first, under its id", async () => {
    doubles.stored = keptConversation();
    doubles.useAssistant.mockImplementation(useFakeAssistant);
    doubles.useBuild.mockReturnValue({ progress: null, build: doubles.build });
    doubles.save.mockClear();
    doubles.build.mockClear();
    const host = mountFlow({ conversation: "c1" });
    expect(doubles.build).not.toHaveBeenCalled();
    await act(async () => button(host, "Build the whole graph")!.click());
    expect(doubles.save).toHaveBeenCalledTimes(1);
    expect(doubles.useBuild.mock.lastCall!).toEqual(["program two", null, { conversation: "c1" }]);
    expect(doubles.build).toHaveBeenCalledTimes(1);
  });

  it("says a conversation a graph was built from is kept as it was", () => {
    doubles.stored = keptConversation();
    doubles.built = true;
    doubles.useAssistant.mockImplementation(useFakeAssistant);
    doubles.useBuild.mockReturnValue({ progress: null, build: doubles.build });
    const host = mountFlow({ conversation: "c1" });
    expect(host.querySelector("[data-built]")?.textContent).toContain("A graph was built from this conversation");
    doubles.built = false;
  });

  it("opened at a decision, says it was built just above it, where the page lands", () => {
    doubles.stored = keptConversation();
    doubles.built = true;
    doubles.useAssistant.mockImplementation(useFakeAssistant);
    doubles.useBuild.mockReturnValue({ progress: null, build: doubles.build });
    const scrolled = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled(this);
    } as never;
    const host = mountFlow({ conversation: "c1", decision: "award-key" });
    Element.prototype.scrollIntoView = original;
    doubles.built = false;
    const note = host.querySelector("[data-built]")!;
    expect(note.nextElementSibling?.getAttribute("data-decision")).toBe("award-key");
    expect(scrolled).toHaveBeenCalledWith(note);
  });
});
