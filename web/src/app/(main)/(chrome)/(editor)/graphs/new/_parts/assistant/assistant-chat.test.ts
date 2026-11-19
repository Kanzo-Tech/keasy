// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type AssistantMessage, toStored } from "@/lib/assistant-conversation";
import { AssistantChat, type AssistantChatProps } from "./assistant-chat";
import { holdsLine } from "./panel";
import type { DecisionItem, Question } from "./model";
import type { Seed } from "./use-assistant";
import type { SourceFile } from "../sources";

// Next's `Link` does not load outside Next (`next/link` resolves only under its bundler); the
// hand-off is an anchor to the same `href` either way.
vi.mock("@kanzo-tech/navigation/next", () => ({
  Link: (props: Record<string, unknown>) => createElement("a", props),
  useRouter: () => ({ push: vi.fn() }),
}));

// What the chat and the flow read from outside, each a double: the page's model, the preview's
// graph and Ask over it, the preview and the build, the kept conversation, and the hook's Tasks.
const ask = vi.hoisted(() => ({ sendMessage: vi.fn(async () => {}), messages: [] as unknown[] }));
const load = vi.hoisted(() => ({ state: "ready" }));
vi.mock("@/lib/ai", () => ({ usePreloadModel: () => {}, useModelLoad: () => load }));
vi.mock("@/components/model-status", () => ({ ModelStatus: () => null }));
vi.mock("@/lib/fossil/graph", () => ({ GraphScope: ({ children }: { children: unknown }) => children }));
vi.mock("@/lib/fossil/ask", () => ({
  useGraphAsk: () => ({ chat: { messages: ask.messages, status: "ready", sendMessage: ask.sendMessage, error: undefined }, graph: {}, over: {} }),
}));
const doubles = vi.hoisted(() => ({
  usePreview: vi.fn((program: string | null) => ({ state: program === null ? "idle" : "running", graph: null, rerun: () => {} })),
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
    id: id ?? "c1",
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

const nobel = { name: "nobel", url: "s3://lake/nobel/", direction: "source", secret: "aws" } as const;
const file = (name: string, size: number): SourceFile => ({
  id: `nobel:${name}`,
  name,
  kind: "file",
  reader: "csv",
  line: `${name.replace(".csv", "")} := io.csv("@nobel/${name}")`,
  reference: `@nobel/${name}`,
  size,
  vocabulary: false,
});

const base: AssistantChatProps = {
  connections: [nobel],
  list: async () => [file("laureates.csv", 120_000), file("awards.csv", 4_000)],
  selected: new Set(),
  vocabularies: new Set(),
  reading: null,
  problems: [],
  understanding: {
    things: [{ id: "laureates", name: "Laureates", count: 1018, holds: ["name", "gender", "birth_date"] }],
    relations: [{ id: "r", sentence: "Each award has a laureate, a category and a year.", example: ["Marie Curie", "Physics", "1903"] }],
  },
  offers: [{ id: "q1", text: "Who has won more than one Nobel?", spec: { of: "Award", show: { kind: "chart", type: "bar", x: "laureate.name", y: { op: "count" } } } }],
  decisions: null,
  build: null,
  failures: [],
  files: [],
  program: null,
  preview: { state: "idle", rerun: () => {} },
  onBuild: () => {},
  onPick: () => {},
  onDrop: () => {},
  writing: false,
  onChoose: () => {},
  questions: [],
  onQuestionsChange: () => {},
  onAdvanced: () => {},
};

const mounted: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The chat with its questions kept, as the host keeps them. */
function Harness(props: AssistantChatProps) {
  const [questions, setQuestions] = useState<Question[]>([...props.questions]);
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

/** The composer's send, as the person presses it. */
const send = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button[type="submit"]')!;

/** Write in the composer's field, as the person types. */
function write(host: HTMLElement, text: string) {
  const field = host.querySelector("textarea")!;
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    set.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Send the first message — the picked files, and what they are about if the person says — to what comes after reading. */
async function through(host: HTMLElement, about = "") {
  if (about) write(host, about);
  await act(async () => send(host).click());
}

describe("the assistant, as a conversation", () => {
  it("opens on what the person may do, and sends nothing until a source is picked", () => {
    const { host } = mount({});
    expect(host.querySelector("[data-empty]")?.textContent).toContain("What would you like to explore?");
    expect(host.querySelector("[data-empty]")?.textContent).toContain("Add files with the +");
    expect(send(host).disabled).toBe(true);
    // One +, and no card until something is picked.
    expect(host.querySelector('[aria-label="Add files"]')).not.toBeNull();
    expect(host.querySelector("[data-file-card]")).toBeNull();
    // The chat alone: the panel opens with the first message.
    expect(host.querySelector('[aria-label="Your graph"]')).toBeNull();
  });

  it("shows what was picked as cards, and drops one with its cross", async () => {
    const onDrop = vi.fn();
    const { host } = mount({ selected: new Set(["nobel:laureates.csv", "nobel:awards.csv"]), onDrop });
    expect([...host.querySelectorAll("[data-file-card]")].map((c) => c.textContent)).toEqual(["laureates.csv", "awards.csv"]);
    await act(async () => host.querySelector<HTMLElement>('[aria-label="Remove awards.csv"]')!.click());
    expect(onDrop).toHaveBeenCalledWith(["nobel:awards.csv"]);
  });

  it("the first message is the files as a chip above what they are about, and one line says they are read", async () => {
    const onReplies = vi.fn();
    const { host, render } = mount({ selected: new Set(["nobel:laureates.csv", "nobel:awards.csv"]), onReplies,
      reading: { done: 0, total: 2 },
      files: [{ connection: "nobel", path: "laureates.csv" }, { connection: "nobel", path: "awards.csv" }],
    });
    await through(host, "Nobel prizes");
    expect(replies(host)).toEqual(["@nobel · 2 filesNobel prizes"]);
    expect(host.querySelector("textarea")?.disabled).toBe(true);
    expect(host.querySelector("textarea")?.placeholder).toBe("Reading your files…");
    render({ reading: { done: 1, total: 2 } });
    expect(host.querySelector("[data-working]")?.textContent).toBe("Reading 2 files");
    expect(onReplies).toHaveBeenLastCalledWith({ about: "Nobel prizes", built: false });
  });

  it("puts what was found in the panel beside the conversation, and the thread points to it", async () => {
    const { host } = mount({ selected: new Set(["nobel:laureates.csv"]), decisions: [] });
    await through(host);
    const panel = host.querySelector('[aria-label="Your graph"]')!;
    expect(panel.querySelector('[data-thing="laureates"]')?.textContent).toContain("Laureates");
    expect(panel.textContent).toContain("Each one holds name, gender and birth date.");
    expect(panel.textContent).toContain("Each award has a laureate, a category and a year.");
    // The thread says it in a line; the counts are the panel's.
    expect(host.textContent).toContain("I read your files and found Laureates. What each one holds is under Data, beside this.");
    // The program is written next, and the line says so.
    expect(host.querySelector("[data-working]")?.textContent).toBe("Writing the program");
  });

  it("keeps the composer on while a decision is open: nothing is blocked but the build", async () => {
    const { host } = mount({ selected: new Set(["nobel:laureates.csv"]), decisions: [award], program: "program" });
    await through(host);
    const field = host.querySelector("textarea")!;
    expect(field.disabled).toBe(false);
    expect(field.placeholder).toBe("Ask anything about your data; I'll answer once the preview is ready");
    expect(button(host, "Build the graph")?.disabled).toBe(true);
    expect(host.querySelector("[data-waits]")?.textContent).toBe("The build waits on 1 question with no safe answer");
  });

  it("the build's wait leads to the decision it waits on, in the conversation", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const { host } = mount({ selected: new Set(["nobel:laureates.csv"]), decisions: [award], program: "program" });
    await through(host);
    await act(async () => button(host, "1 question with no safe answer")!.click());
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled.mock.contexts[0]).toBe(host.querySelector('[data-decision="award-key"]'));
  });

  it("each decision is a turn of its own, counted, and picking an option emits its id", async () => {
    const onChoose = vi.fn();
    const { host } = mount({ selected: new Set(["nobel:laureates.csv"]), decisions: [award, country], onChoose });
    await through(host);
    expect(host.textContent).toContain("Decisions with no safe answer: 2. They are yours to decide");
    expect(host.textContent).toContain("Decision 1 of 2");
    // None waits on another: both are asked at once.
    expect(host.textContent).toContain("Decision 2 of 2");
    const radios = [...host.querySelector('[data-decision="award-key"]')!.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((r) => r.value)).toEqual(["two", "one"]);
    await act(async () => radios[1].click());
    expect(onChoose).toHaveBeenCalledWith("award-key", "one");
  });

  it("a chosen option is said once, selected in its turn, and changed there", async () => {
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
    await act(async () => [...options].find((r) => r.value === "two")!.click());
    expect(onChoose).toHaveBeenCalledWith("award-key", "two");
  });

  it("an assumption is said as what was taken, its options behind Change, and blocks nothing", async () => {
    const onChoose = vi.fn();
    const { host } = mount({ selected: new Set(["nobel:laureates.csv"]), decisions: [share], onChoose, program: "program" });
    await through(host);
    const note = host.querySelector('[data-assumption="share"]');
    expect(note?.textContent).toContain("I assumed: A fraction of the prize");
    // The options are behind Change, the one door to them.
    expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    await act(async () => button(host, "Change")!.click());
    expect(host.querySelector('[data-decision="share"] [data-slot="question-prompt"]')?.textContent).toBe(share.decision.question);
    const radios = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.find((r) => r.checked)?.value).toBe("fraction");
    // It blocks nothing, the build included.
    expect(host.textContent).toContain("What would you like to know?");
    expect(button(host, "Build the graph")?.disabled).toBe(false);
    await act(async () => radios.find((r) => r.value === "amount")!.click());
    expect(onChoose).toHaveBeenCalledWith("share", "amount");
  });

  it("a question on offer becomes the person's, with whether it can be answered; Preview stays off until it has answers", async () => {
    const { host } = mount({ selected: new Set(["nobel:laureates.csv"]), decisions: [] });
    await through(host);
    expect(host.textContent).toContain("Take one of these, or ask your own below. I’ll answer each one under Preview");
    await act(async () => button(host, "Who has won more than one Nobel?")!.click());
    const asked = [...host.querySelectorAll("[data-reply]")].at(-1)!;
    expect(asked.querySelector("[data-question]")?.textContent).toBe("Who has won more than one Nobel?");
    expect(asked.textContent).toContain("Not checked yet");
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Data");
    expect(host.querySelector('[role="tab"][data-value="preview"]')?.hasAttribute("data-disabled")).toBe(true);
  });

  it("takes a question written in the composer at any time", async () => {
    const { host } = mount({ selected: new Set(["nobel:laureates.csv"]), decisions: [award], offers: [] });
    await through(host);
    expect(host.textContent).toContain("Ask your own below");
    write(host, "Which country has the most laureates?");
    await act(async () => send(host).click());
    expect(host.querySelector("[data-question]")?.textContent).toBe("Which country has the most laureates?");
    expect(host.querySelector("textarea")?.value).toBe("");
  });

  it("on a phone, puts the panel in a sheet opened from a bar that says what is in it", async () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({ ...matchMedia.call(window, query), matches: true, addEventListener() {}, removeEventListener() {} })) as typeof matchMedia;
    try {
      const { host } = mount({ selected: new Set(["nobel:laureates.csv"]), decisions: [award] });
      await through(host);
      expect(host.querySelector('[aria-label="Your graph"]')).toBeNull();
      expect(button(host, "Your graph · 1 kind · 1 open question")).toBeDefined();
    } finally {
      window.matchMedia = matchMedia;
    }
  });

  it("marks with a checkpoint where the conversation turns to asking the data, once the preview answers", async () => {
    const { host, render } = mount({
      selected: new Set(["nobel:laureates.csv"]),
      decisions: [],
      program: "program",
      preview: { state: "running", graph: null, rerun: () => {} },
    });
    await through(host);
    expect(host.querySelector("[data-checkpoint]")).toBeNull();
    expect(host.querySelector("[data-working]")?.textContent).toBe("Running the preview");
    render({ program: "program", preview: { state: "ready", graph: { name: "preview-1" } as never, rerun: () => {} } });
    expect(host.querySelector("[data-checkpoint]")?.textContent).toBe("Your data is ready to ask · first 200 rows");
    expect(host.querySelector("[data-working]")).toBeNull();
    expect(host.querySelector("textarea")?.placeholder).toBe("Ask anything about your data");
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Preview");
  });

  it("answers each question kept over the preview, in the panel", async () => {
    ask.sendMessage.mockClear();
    const { host } = mount({
      selected: new Set(["nobel:laureates.csv"]),
      decisions: [],
      program: "program",
      preview: { state: "ready", graph: { name: "preview-1" } as never, rerun: () => {} },
    });
    await through(host);
    expect(host.querySelector('[aria-label="Preview"]')?.textContent).toContain("Ask a question in the conversation, and it is answered here.");
    write(host, "Who won twice?");
    await act(async () => send(host).click());
    // Typed, it is Ask's Task's to read; a chip is asked as its spec (below).
    expect(ask.sendMessage).toHaveBeenCalledWith({ text: "Who won twice?" });
  });

  it("asks a question taken from a chip as its spec, with no model to wait for", async () => {
    ask.sendMessage.mockClear();
    load.state = "loading";
    try {
      const spec = { of: "Award", show: { kind: "chart", type: "bar", x: "category", y: { op: "count" } } } as const;
      const { host } = mount({
        selected: new Set(["nobel:laureates.csv"]),
        decisions: [],
        program: "program",
        preview: { state: "ready", graph: { name: "preview-1" } as never, rerun: () => {} },
        questions: [{ id: "q1", text: "Award count by category", answerable: true, spec }],
      });
      await through(host);
      expect(ask.sendMessage).toHaveBeenCalledWith({
        parts: [
          { type: "text", text: "Award count by category" },
          { type: "data-ask", data: { spec } },
        ],
      });
      expect(host.textContent).not.toContain("Preparing the model");
    } finally {
      load.state = "ready";
    }
  });

  it("marks a typed question by what the preview's Ask answered, and keeps the spec it read it as", async () => {
    const spec = { of: "Laureate", show: { kind: "table", columns: ["name"] } };
    ask.messages = [
      { id: "u", role: "user", parts: [{ type: "text", text: "Who won twice?" }] },
      { id: "a", role: "assistant", parts: [{ type: "data-ask", data: { spec } }, { type: "data-answer", data: { spec } }] },
    ];
    try {
      const onSave = vi.fn();
      const { host } = mount({
        selected: new Set(["nobel:laureates.csv"]),
        decisions: [],
        program: "program",
        preview: { state: "ready", graph: { name: "preview-1" } as never, rerun: () => {} },
        questions: [{ id: "q1", text: "Who won twice?", answerable: null }],
        initial: { about: "", built: false },
        onSave,
      });
      await through(host);
      expect(host.querySelector("[data-question]")?.parentElement?.textContent).toContain("These files can answer it");
      const saved = onSave.mock.lastCall![0] as AssistantMessage[];
      expect(saved.flatMap((m) => m.parts)).toContainEqual({ type: "data-question", data: { id: "q1", text: "Who won twice?", spec } });
    } finally {
      ask.messages = [];
    }
  });

  it("says a failed preview with its problem and a retry", async () => {
    const rerun = vi.fn();
    const { host, render } = mount({
      selected: new Set(["nobel:laureates.csv"]),
      decisions: [],
      program: "program",
      preview: { state: "running", graph: null, rerun },
    });
    await through(host);
    // Nothing to preview yet: its tab is off.
    expect(host.querySelector('[role="tab"][data-value="preview"]')?.hasAttribute("data-disabled")).toBe(true);
    render({ program: "program", preview: { state: "failed", problem: new Error("The run stopped"), graph: null, rerun } });
    await act(async () => host.querySelector<HTMLElement>('[role="tab"][data-value="preview"]')!.click());
    await act(async () => button(host, "Try again")!.click());
    expect(rerun).toHaveBeenCalled();
  });

  it("dims the answers a rerun replaces, under the heading's Updating…, until the new ones land", async () => {
    const graph = { name: "preview-1" } as never;
    const { host, render } = mount({
      selected: new Set(["nobel:laureates.csv"]),
      decisions: [],
      program: "program",
      preview: { state: "ready", graph, rerun: () => {} },
    });
    await through(host);
    await act(async () => button(host, "Who has won more than one Nobel?")!.click());
    const answers = () => host.querySelector("[data-preview-answers]")!.parentElement!;
    expect(answers().hasAttribute("data-stale")).toBe(false);
    render({ program: "program", preview: { state: "running", graph, rerun: () => {} } });
    expect(answers().hasAttribute("data-stale")).toBe(true);
    expect(answers().getAttribute("aria-busy")).toBe("true");
    const heading = host.querySelector('[aria-label="Preview"] p')!;
    expect(heading.textContent).toContain("Your data over its first 200 rows");
    expect(heading.querySelector('[role="status"]')?.textContent).toBe("Updating…");
    render({ program: "program", preview: { state: "ready", graph: { name: "preview-2" } as never, rerun: () => {} } });
    expect(answers().hasAttribute("data-stale")).toBe(false);
    expect(host.textContent).not.toContain("Updating…");
  });

  it("opens the program in the editor from the panel, once there is one", async () => {
    const onAdvanced = vi.fn();
    const { host, render } = mount({ selected: new Set(["nobel:laureates.csv"]), decisions: [], onAdvanced });
    await through(host);
    // No program yet: no actions on it.
    expect(button(host, "Open in the editor")).toBeUndefined();
    render({ program: "program" });
    await act(async () => button(host, "Open in the editor")!.click());
    expect(onAdvanced).toHaveBeenCalledTimes(1);
  });

  it("builds the graph only on request, from the transcript with the person's message in it, and says how far it is", async () => {
    const onBuild = vi.fn();
    const { host, render } = mount({ selected: new Set(["nobel:laureates.csv"]), decisions: [], onBuild });
    await through(host);
    // No program yet: nothing to build.
    expect(button(host, "Build the graph")).toBeUndefined();
    render({ program: "program" });
    await act(async () => button(host, "Build the graph")!.click());
    expect(onBuild).toHaveBeenCalledTimes(1);
    const kinds = (onBuild.mock.calls[0][0] as AssistantMessage[]).map((m) => m.id);
    expect(kinds.slice(-3)).toEqual(["ask", "build-reply", "build"]);
    expect(replies(host).at(-1)).toBe("Build the graph");
    render({ program: "program", build: { state: "building", graphId: "g1" } });
    expect(host.querySelector("[data-working]")?.textContent).toBe("Building the graph from every row");
    // Asked for once: the panel has nothing more to build.
    expect(button(host, "Build the graph")).toBeUndefined();
  });

  it("once built, closes the conversation and hands off to Ask or the graph, with the person's questions as prompts", async () => {
    const { host } = mount({
      selected: new Set(["nobel:laureates.csv"]),
      files: [{ connection: "nobel", path: "laureates.csv" }],
      decisions: [],
      program: "program",
      build: { state: "done", graphId: "g1" },
      initial: { about: "", built: false },
      questions: [{ id: "q1", text: "Who has won more than one Nobel?", answerable: true }],
    });
    const panel = host.querySelector("[data-built-panel]")!;
    expect(panel.textContent).toContain("Your graph is ready to explore.");
    expect([...panel.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "/graphs/g1/discover?panel=ask",
      "/graphs/g1",
      `/graphs/g1/discover?panel=ask&q=${encodeURIComponent("Who has won more than one Nobel?")}`,
    ]);
    // The composer gives way to the close.
    expect(host.querySelector("textarea")).toBeNull();
    const closed = host.querySelector("[data-closed]")!;
    expect(closed.textContent).toContain("This conversation built nobel, and stays as it was built.");
    expect(closed.querySelector("a")?.getAttribute("href")).toMatch(/^\/graphs\/new\/assistant\?new=/);
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
      data: { id: "q1", text: "Who has won more than one Nobel?", spec: base.offers![0]!.spec },
    });
  });

  it("does not save a conversation only read, nor while what follows a reply is not said yet", async () => {
    const onSave = vi.fn();
    mount({ selected: new Set(["nobel:laureates.csv"]), decisions: [], onSave, initial: { about: "", built: false } });
    expect(onSave).not.toHaveBeenCalled();
    const reading = mount({ selected: new Set(["nobel:laureates.csv"]), reading: { done: 0, total: 1 }, onSave });
    await through(reading.host);
    // Nothing is saved while the files are read, nor while the model answers: the turns after the
    // first message are not said yet, and a save would drop them.
    expect(onSave).not.toHaveBeenCalled();
    reading.render({ reading: null });
    expect(onSave).not.toHaveBeenCalled();
    reading.render({ reading: null, decisions: [] });
    expect(onSave).toHaveBeenCalledTimes(1);
    const ids = (onSave.mock.lastCall![0] as AssistantMessage[]).map((m) => m.id);
    expect(ids.slice(0, 2)).toEqual(["sent", "understood"]);
  });

  it("a step that failed is said where the conversation stopped, with a retry", async () => {
    const retry = vi.fn();
    const { host } = mount({
      selected: new Set(["nobel:laureates.csv"]),
      decisions: [],
      offers: null,
      failures: [{ task: "mapping", problem: new Error("The program does not compile"), retry }],
    });
    await through(host);
    expect(host.querySelector('[data-task="mapping"]')?.textContent).toBe("I could not write how these files become your graph.");
    expect(host.querySelector("[data-problem]")).not.toBeNull();
    await act(async () => button(host, "Try again")!.click());
    expect(retry).toHaveBeenCalled();
  });

  it("says each change of the person's replies, for the Tasks that wait on them", async () => {
    const onReplies = vi.fn();
    const { host } = mount({ selected: new Set(["nobel:laureates.csv"]), onReplies });
    await through(host);
    expect(onReplies).toHaveBeenLastCalledWith({ about: "", built: false });
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
    pick: () => {},
    drop: () => {},
    choose: (decision: string, picked: string) => setChosen((prev) => ({ ...prev, [decision]: picked })),
  };
}

/** A conversation kept: one file, the award decision taken as *two*, and one question. */
function keptConversation(): AssistantMessage[] {
  const question = { id: "q1", text: "Who has won more than one Nobel?", answerable: true };
  const { turns } = converse(
    { selected: new Set(["nobel:laureates.csv"]), reading: null, decisions: [{ ...award, chosen: "two" }], questions: [question] },
    { ...NO_REPLIES, about: "Nobel prizes" },
  );
  return messagesOf(turns, { files: [{ connection: "nobel", path: "laureates.csv" }], program: "program two" });
}

function mountFlow(props: { conversation?: string } = {}) {
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
      "@nobel · 1 fileNobel prizes",
      expect.stringContaining("Who has won more than one Nobel?"),
    ]);
    expect(doubles.useAssistant.mock.lastCall![0]).toMatchObject({
      about: "Nobel prizes",
      seed: { files: [{ connection: "nobel", path: "laureates.csv" }], chosen: { "award-key": "two" }, program: "program two" },
    });
    expect(doubles.usePreview.mock.lastCall![0]).toBe("program two");
  });

  it("a decision changed is a program changed, and the preview runs it", async () => {
    doubles.stored = keptConversation();
    doubles.useAssistant.mockImplementation(useFakeAssistant);
    doubles.useBuild.mockReturnValue({ progress: null, build: doubles.build });
    doubles.save.mockClear();
    const host = mountFlow({ conversation: "c1" });
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
    await act(async () => button(host, "Build the graph")!.click());
    expect(doubles.save).toHaveBeenCalledTimes(1);
    expect(doubles.useBuild.mock.lastCall!).toEqual(["program two", null, { conversation: "c1", name: "nobel" }]);
    expect(doubles.build).toHaveBeenCalledTimes(1);
  });

  it("opens a conversation a graph was built from as the closed thread: read, and never saved", async () => {
    doubles.stored = keptConversation();
    doubles.built = true;
    doubles.useAssistant.mockImplementation(useFakeAssistant);
    doubles.useBuild.mockReturnValue({ progress: null, build: doubles.build });
    doubles.save.mockClear();
    const host = mountFlow({ conversation: "c1" });
    doubles.built = false;
    // The bar of a build, and nothing of the note that carried on in a new conversation.
    expect(host.querySelector("[data-closed]")?.textContent).toContain("stays as it was built");
    expect(host.querySelector("[data-built]")).toBeNull();
    expect(button(host, "Build the graph")).toBeUndefined();
    expect(host.querySelector("textarea")).toBeNull();
    // Its decisions are read, not taken again.
    const one = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => r.value === "one")!;
    await act(async () => one.click());
    expect(doubles.useAssistant.mock.lastCall![0]).toMatchObject({ seed: { chosen: { "award-key": "two" } } });
    expect(doubles.save).not.toHaveBeenCalled();
  });
});

describe("what each one holds", () => {
  it("is said in the data's own words, made readable", () => {
    expect(holdsLine([])).toBeNull();
    expect(holdsLine(["name", "gender"])).toBe("name and gender");
    expect(holdsLine(["name", "gender", "birth_date", "birth_country", "died"])).toBe("name, gender, birth date, birth country and died");
    expect(holdsLine(["id", "name", "gender", "birth_date", "birth_country", "died"])).toBe("id, name, gender, birth date and 2 more");
  });
});
